//! Raw (driver-bypassing) printing to a Windows printer: sends TSPL / ZPL label commands as-is.
use std::ptr::{null, null_mut};
use windows_sys::Win32::Foundation::HANDLE;
use windows_sys::Win32::Graphics::Printing::{
    ClosePrinter, EndDocPrinter, EndPagePrinter, EnumPrintersW, GetDefaultPrinterW, OpenPrinterW,
    StartDocPrinterW, StartPagePrinter, WritePrinter, DOC_INFO_1W, PRINTER_ENUM_CONNECTIONS,
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

/// Sends `data` to the named printer as a RAW job. Empty name = the Windows default printer.
pub fn print_raw(printer: &str, data: &[u8]) -> Result<(), String> {
    if data.is_empty() {
        return Err("nothing to print".into());
    }
    let name = if printer.trim().is_empty() {
        let (_, def) = list_printers()?;
        if def.is_empty() {
            return Err("no printer selected and no Windows default printer".into());
        }
        def
    } else {
        printer.to_string()
    };
    unsafe {
        let mut h: HANDLE = 0 as HANDLE;
        let wname = wide(&name);
        if OpenPrinterW(wname.as_ptr(), &mut h, null()) == 0 || h as usize == 0 {
            return Err(format!("could not open printer \"{}\"", name));
        }
        let mut doc_name = wide("Manokshmi ClothBill labels");
        let mut dtype = wide("RAW");
        let doc = DOC_INFO_1W {
            pDocName: doc_name.as_mut_ptr(),
            pOutputFile: null_mut(),
            pDatatype: dtype.as_mut_ptr(),
        };
        if StartDocPrinterW(h, 1, &doc as *const DOC_INFO_1W) == 0 {
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
        ClosePrinter(h);
        if ok == 0 || written as usize != data.len() {
            return Err("could not send all data to the printer".into());
        }
        Ok(())
    }
}
