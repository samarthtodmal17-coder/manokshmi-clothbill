//! Raw (driver-bypassing) printing to a Windows printer: sends TSPL / ZPL label commands as-is.
use std::ptr::{null, null_mut};
use windows_sys::Win32::Foundation::HANDLE;
use windows_sys::Win32::Graphics::Printing::{
    ClosePrinter, EndDocPrinter, EndPagePrinter, EnumJobsW, EnumPrintersW, GetDefaultPrinterW, OpenPrinterW,
    SetJobW, StartDocPrinterW, StartPagePrinter, WritePrinter, DOC_INFO_1W, JOB_CONTROL_DELETE, JOB_INFO_1W,
    JOB_STATUS_BLOCKED_DEVQ, JOB_STATUS_DELETED, JOB_STATUS_DELETING, JOB_STATUS_ERROR, JOB_STATUS_OFFLINE,
    JOB_STATUS_PAPEROUT, JOB_STATUS_PAUSED, JOB_STATUS_USER_INTERVENTION, PRINTER_ENUM_CONNECTIONS,
    PRINTER_ENUM_LOCAL, PRINTER_INFO_4W,
};

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

unsafe fn from_wide(p: *const u16) -> String {
    if p.is_null() {
        return String::new();
    }
    let mut len = 0usize;
    while *p.add(len) != 0 {
        len += 1;
    }
    String::from_utf16_lossy(std::slice::from_raw_parts(p, len))
}

/// Names of the printers installed on this PC, plus the Windows default (may be empty).
pub fn list_printers() -> Result<(Vec<String>, String), String> {
    unsafe {
        let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
        let mut needed: u32 = 0;
        let mut returned: u32 = 0;
        EnumPrintersW(flags, null(), 4, null_mut(), 0, &mut needed, &mut returned);
        let mut names: Vec<String> = Vec::new();
        if needed > 0 {
            // u64 storage keeps the buffer aligned for PRINTER_INFO_4W
            let mut aligned: Vec<u64> = vec![0u64; needed as usize / 8 + 2];
            let ptr = aligned.as_mut_ptr() as *mut u8;
            let ok = EnumPrintersW(flags, null(), 4, ptr, needed, &mut needed, &mut returned);
            if ok == 0 {
                return Err("could not list printers".into());
            }
            let infos = ptr as *const PRINTER_INFO_4W;
            for i in 0..returned as usize {
                let info = &*infos.add(i);
                let n = from_wide(info.pPrinterName);
                if !n.is_empty() {
                    names.push(n);
                }
            }
        }
        names.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
        let mut dlen: u32 = 0;
        GetDefaultPrinterW(null_mut(), &mut dlen);
        let mut def = String::new();
        if dlen > 0 {
            let mut dbuf = vec![0u16; dlen as usize];
            if GetDefaultPrinterW(dbuf.as_mut_ptr(), &mut dlen) != 0 {
                def = from_wide(dbuf.as_ptr());
            }
        }
        Ok((names, def))
    }
}

fn resolve_printer(printer: &str) -> Result<String, String> {
    if printer.trim().is_empty() {
        let (_, def) = list_printers()?;
        if def.is_empty() {
            return Err("no printer selected and no Windows default printer".into());
        }
        Ok(def)
    } else {
        Ok(printer.to_string())
    }
}

const DOC_PREFIX: &str = "Manokshmi ClothBill";

const STUCK: u32 = JOB_STATUS_ERROR
    | JOB_STATUS_OFFLINE
    | JOB_STATUS_PAPEROUT
    | JOB_STATUS_PAUSED
    | JOB_STATUS_BLOCKED_DEVQ
    | JOB_STATUS_USER_INTERVENTION;

/// (job id, status flags, document name) of every job waiting on an open printer.
unsafe fn enum_jobs(h: HANDLE) -> Result<Vec<(u32, u32, String)>, String> {
    let mut needed: u32 = 0;
    let mut returned: u32 = 0;
    EnumJobsW(h, 0, 200, 1, null_mut(), 0, &mut needed, &mut returned);
    let mut out = Vec::new();
    if needed > 0 {
        // u64 storage keeps the buffer aligned for JOB_INFO_1W
        let mut aligned: Vec<u64> = vec![0u64; needed as usize / 8 + 2];
        let ptr = aligned.as_mut_ptr() as *mut u8;
        if EnumJobsW(h, 0, 200, 1, ptr, needed, &mut needed, &mut returned) == 0 {
            return Err("could not read the print queue".into());
        }
        let infos = ptr as *const JOB_INFO_1W;
        for i in 0..returned as usize {
            let info = &*infos.add(i);
            out.push((info.JobId, info.Status, from_wide(info.pDocument)));
        }
    }
    Ok(out)
}

/// Deletes this app's label jobs from the Windows print queue of `printer`.
/// `only_stuck` = only jobs that are in an error / paper-out / offline / paused state (safe before every print);
/// otherwise every job of this app on that printer is removed. Returns how many jobs were deleted.
pub fn cancel_jobs(printer: &str, only_stuck: bool) -> Result<u32, String> {
    let name = resolve_printer(printer)?;
    unsafe {
        let mut h: HANDLE = 0 as HANDLE;
        let wname = wide(&name);
        if OpenPrinterW(wname.as_ptr(), &mut h, null()) == 0 || h as usize == 0 {
            return Err(format!("could not open printer \"{}\"", name));
        }
        let jobs = enum_jobs(h);
        let mut deleted: u32 = 0;
        if let Ok(list) = jobs {
            for (id, status, doc) in list {
                if !doc.starts_with(DOC_PREFIX) || status & (JOB_STATUS_DELETING | JOB_STATUS_DELETED) != 0 {
                    continue;
                }
                if only_stuck && status & STUCK == 0 {
                    continue;
                }
                if SetJobW(h, id, 0, null_mut(), JOB_CONTROL_DELETE) != 0 {
                    deleted += 1;
                }
            }
        } else if let Err(e) = jobs {
            ClosePrinter(h);
            return Err(e);
        }
        ClosePrinter(h);
        Ok(deleted)
    }
}

/// Sends `data` to the named printer as a RAW job. Empty name = the Windows default printer.
pub fn print_raw(printer: &str, data: &[u8]) -> Result<(), String> {
    print_raw_named(printer, data, "labels")
}

/// Same as `print_raw` with a short job label (the job shows in Windows as "Manokshmi ClothBill <label>").
pub fn print_raw_named(printer: &str, data: &[u8], label: &str) -> Result<(), String> {
    if data.is_empty() {
        return Err("nothing to print".into());
    }
    let name = resolve_printer(printer)?;
    unsafe {
        let mut h: HANDLE = 0 as HANDLE;
        let wname = wide(&name);
        if OpenPrinterW(wname.as_ptr(), &mut h, null()) == 0 || h as usize == 0 {
            return Err(format!("could not open printer \"{}\"", name));
        }
        let mut doc_name = wide(&format!("{} {}", DOC_PREFIX, label));
        let mut dtype = wide("RAW");
        let doc = DOC_INFO_1W {
            pDocName: doc_name.as_mut_ptr(),
            pOutputFile: null_mut(),
            pDatatype: dtype.as_mut_ptr(),
        };
        let job_id = StartDocPrinterW(h, 1, &doc as *const DOC_INFO_1W);
        if job_id == 0 {
            ClosePrinter(h);
            return Err("printer refused the print job".into());
        }
        if StartPagePrinter(h) == 0 {
            EndDocPrinter(h);
            ClosePrinter(h);
            return Err("printer refused the page".into());
        }
        let mut written: u32 = 0;
        let ok = WritePrinter(h, data.as_ptr() as *const core::ffi::c_void, data.len() as u32, &mut written);
        EndPagePrinter(h);
        EndDocPrinter(h);
        if ok == 0 || written as usize != data.len() {
            ClosePrinter(h);
            return Err("could not send all data to the printer".into());
        }
        // Watch the job for a few seconds. If the printer reports paper-out / offline / error, delete the job
        // right away, so it cannot come out later (together with the next print) when a new roll is loaded.
        let mut verdict: Result<(), String> = Ok(());
        for _ in 0..12 {
            std::thread::sleep(std::time::Duration::from_millis(250));
            match enum_jobs(h) {
                Ok(list) => match list.iter().find(|j| j.0 == job_id) {
                    None => break, // already printed and gone from the queue
                    Some(j) => {
                        if j.1 & STUCK != 0 && j.1 & (JOB_STATUS_DELETING | JOB_STATUS_DELETED) == 0 {
                            SetJobW(h, job_id, 0, null_mut(), JOB_CONTROL_DELETE);
                            verdict = Err("PRINTER_STUCK: the printer is out of paper, offline or in error. This print was cancelled so it will not come out later. Fix the printer / load the roll, then print again.".into());
                            break;
                        }
                    }
                },
                Err(_) => break,
            }
        }
        ClosePrinter(h);
        verdict
    }
}
