/* Manokshmi ClothBill - desktop (Tauri) integration layer.
 * Loaded at the end of <body>. Everything here is inert in a plain browser
 * tab except the print/external-link helpers, which fall back to window.open.
 * Provides: print window shim, external links, licence gate, daily + on-close
 * backups, safe close, automatic updates.
 */
(function(){
  'use strict';

  var IS_TAURI = !!(window.__TAURI__ && window.__TAURI__.core);
  window.IS_TAURI = IS_TAURI;

  var APP_VERSION = '0.1.3';
  var PRODUCT_ID = 'cloth-pos';
  var LICENSE_API_BASE = 'https://licensing-platform.pages.dev';
  var LICENSE_STORAGE_KEY = 'clothBillLicense_v1';
  var DEVICE_ID_STORAGE_KEY = 'clothBillDeviceId_v1';
  var LICENSE_RECHECK_DAYS = 14;
  var BACKUP_FOLDER = 'Manokshmi ClothBill Backups';
  var BACKUP_KEEP = 14;
  window.CLOTHBILL_VERSION = APP_VERSION;

  function msg(text, type){ try{ if(typeof toast === 'function') toast(text, type || ''); else console.log(text); }catch(e){} }
  function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }

  /* ---------- persisted debug log (Documents\Manokshmi ClothBill Backups\debug.log) ---------- */
  function folderPath(){
    return window.__TAURI__.path.documentDir().then(function(d){ return window.__TAURI__.path.join(d, BACKUP_FOLDER); });
  }
  function plog(text){
    console.log('[clothbill]', text);
    if(!IS_TAURI) return;
    try{
      folderPath().then(function(fp){
        return window.__TAURI__.fs.mkdir(fp, {recursive:true}).then(function(){ return window.__TAURI__.path.join(fp, 'debug.log'); });
      }).then(function(file){
        return window.__TAURI__.fs.writeTextFile(file, '[' + new Date().toISOString() + '] ' + text + '\n', {append:true});
      }).catch(function(){});
    }catch(e){}
  }

  /* ---------- printing: window.open() is blocked inside Tauri, so print through a hidden iframe ---------- */
  window.openPrintWindow = function(features){
    if(!IS_TAURI) return window.open('', '_blank', features);
    var buf = '', frame = null, loaded = null;
    function render(){
      var old = document.getElementById('__printFrame');
      if(old) old.remove();
      frame = document.createElement('iframe');
      frame.id = '__printFrame';
      frame.setAttribute('aria-hidden', 'true');
      frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
      loaded = new Promise(function(res){ frame.onload = function(){ setTimeout(res, 200); }; });
      frame.srcdoc = buf;
      document.body.appendChild(frame);
    }
    return {
      document: { write: function(s){ buf += s; }, close: function(){ render(); } },
      focus: function(){},
      close: function(){},
      print: function(){
        if(!frame) render();
        loaded.then(function(){
          try{ frame.contentWindow.focus(); frame.contentWindow.print(); }
          catch(e){ plog('print failed: ' + e); msg('Could not open the print dialog', 'error'); }
        });
      }
    };
  };

  /* ---------- external links (WhatsApp / mailto) ---------- */
  window.openExternal = function(url){
    if(!IS_TAURI){ window.open(url, '_blank'); return null; }
    window.__TAURI__.core.invoke('open_external', {url: url}).catch(function(e){
      plog('open_external failed: ' + e);
      msg('Could not open the link', 'error');
    });
    return null;
  };

  if(!IS_TAURI) return; // everything below is desktop-only

  /* ---------- licence ---------- */
  function getDeviceId(){
    function fallback(){
      var id = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
      if(!id){ id = (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random(); localStorage.setItem(DEVICE_ID_STORAGE_KEY, id); }
      return id;
    }
    return window.__TAURI__.core.invoke('get_device_fingerprint').then(function(id){ return id || fallback(); }).catch(function(){ return fallback(); });
  }
  function getLicense(){ try{ var r = localStorage.getItem(LICENSE_STORAGE_KEY); return r ? JSON.parse(r) : null; }catch(e){ return null; } }
  function setLicense(rec){ try{ localStorage.setItem(LICENSE_STORAGE_KEY, JSON.stringify(rec)); }catch(e){} }
  function callActivate(key, deviceId){
    return fetch(LICENSE_API_BASE + '/api/activate', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({licenseKey: key, deviceId: deviceId, productId: PRODUCT_ID, appVersion: APP_VERSION, dbVersion: String(typeof DB_VERSION !== 'undefined' ? DB_VERSION : 10)})
    }).then(function(r){ return r.json(); });
  }

  function showGate(initialError){
    return new Promise(function(resolve){
      var ov = document.createElement('div');
      ov.id = 'licenseGate';
      ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#f4f1ec;display:flex;align-items:center;justify-content:center;font-family:Arial,sans-serif;';
      ov.innerHTML =
        '<div style="background:#fff;border-radius:14px;box-shadow:0 8px 40px rgba(0,0,0,.15);padding:32px;width:380px;max-width:92vw;text-align:center;">' +
        '<h2 style="margin:0 0 4px;">Manokshmi ClothBill</h2>' +
        '<p style="margin:0 0 18px;color:#666;font-size:13px;">Enter your licence key to activate this computer.<br>Internet is needed only for this first step.</p>' +
        '<input id="lgKey" placeholder="XXXX-XXXX-XXXX-XXXX" autocomplete="off" style="width:100%;box-sizing:border-box;padding:11px;font-size:15px;text-align:center;letter-spacing:1px;border:1px solid #ccc;border-radius:8px;">' +
        '<button id="lgGo" style="margin-top:12px;width:100%;padding:11px;font-size:15px;font-weight:700;border:0;border-radius:8px;background:#7a1f3d;color:#fff;cursor:pointer;">Activate</button>' +
        '<div id="lgErr" style="margin-top:10px;color:#c0392b;font-size:13px;min-height:16px;"></div>' +
        '<div style="margin-top:14px;color:#999;font-size:11px;">Product of Manokshmi Technologies &middot; v' + APP_VERSION + '</div></div>';
      document.body.appendChild(ov);
      var key = ov.querySelector('#lgKey'), go = ov.querySelector('#lgGo'), err = ov.querySelector('#lgErr');
      if(initialError) err.textContent = initialError;
      key.focus();
      key.addEventListener('keydown', function(e){ if(e.key === 'Enter') go.click(); });
      go.addEventListener('click', function(){
        var entered = key.value.trim();
        if(!entered) return;
        err.textContent = ''; go.disabled = true; go.textContent = 'Checking...';
        var deviceId;
        getDeviceId().then(function(d){ deviceId = d; return callActivate(entered, d); }).then(function(res){
          go.disabled = false; go.textContent = 'Activate';
          if(res.ok){
            setLicense({ok:true, licenseKey:entered, deviceId:deviceId, customerName:res.customerName, tier:res.tier, activatedAt:res.activatedAt, lastCheckedAt:new Date().toISOString()});
            ov.remove(); resolve();
          } else err.textContent = res.error || 'Invalid licence key.';
        }).catch(function(){
          go.disabled = false; go.textContent = 'Activate';
          err.textContent = "Couldn't reach the activation server. Check the internet connection and try again.";
        });
      });
    });
  }

  // Awaited by initApp() before the login screen. Resolves once licensed.
  window.ensureLicensed = async function(){
    var rec = getLicense();
    if(!(rec && rec.ok)) await showGate();
    maybeRecheck();
  };

  function maybeRecheck(){
    var rec = getLicense();
    if(!rec || !rec.ok || !navigator.onLine) return;
    var last = rec.lastCheckedAt ? new Date(rec.lastCheckedAt).getTime() : 0;
    if((Date.now() - last) / 86400000 < LICENSE_RECHECK_DAYS) return;
    callActivate(rec.licenseKey, rec.deviceId).then(function(res){
      if(res.ok){ rec.lastCheckedAt = new Date().toISOString(); rec.customerName = res.customerName; rec.tier = res.tier; setLicense(rec); }
      else {
        // Revoked/expired: lock access only. Shop data is never touched.
        localStorage.removeItem(LICENSE_STORAGE_KEY);
        showGate(res.error || 'This licence is no longer active. Please contact support.');
      }
    }).catch(function(){ /* offline or server hiccup: try again next time */ });
  }

  /* ---------- backups (Documents folder, independent of the AppData database) ---------- */
  var backupChain = Promise.resolve();
  function enqueueBackup(fn){
    var p = backupChain.catch(function(){}).then(fn);
    backupChain = p.catch(function(){});
    return p;
  }
  function backupName(){ return 'backup-' + new Date().toISOString().slice(0, 10) + '.json'; }

  async function buildBackup(){
    var names = Object.keys(ALL_STORE_KEYPATHS);
    var results = await Promise.all(names.map(function(n){ return dbGetAll(n); }));
    var data = {};
    names.forEach(function(n, i){ data[n] = results[i]; });
    return {backupVersion: BACKUP_FORMAT_VERSION, exportedAt: new Date().toISOString(), appName: (SETTINGS && SETTINGS.name) || 'Manokshmi ClothBill', data: data};
  }

  async function writeBackup(onlyIfMissing){
    var fs = window.__TAURI__.fs, path = window.__TAURI__.path;
    var fp = await folderPath();
    await fs.mkdir(fp, {recursive:true});
    var file = await path.join(fp, backupName());
    if(onlyIfMissing && await fs.exists(file)) return;
    await fs.writeTextFile(file, JSON.stringify(await buildBackup()));
    var entries = await fs.readDir(fp);
    var names = entries.map(function(e){ return e.name; }).filter(function(n){ return n && /^backup-\d{4}-\d{2}-\d{2}\.json$/.test(n); }).sort();
    var drop = names.slice(0, Math.max(0, names.length - BACKUP_KEEP));
    for(var i = 0; i < drop.length; i++){
      try{ await fs.remove(await path.join(fp, drop[i])); }catch(e){ /* already gone */ }
    }
  }

  // Called once the app is running (after login). Never blocks billing.
  window.clothStartDesktopServices = function(){
    if(window.__clothServicesStarted) return;
    window.__clothServicesStarted = true;
    window.__clothAppStarted = true;
    enqueueBackup(function(){ return writeBackup(true); }).catch(function(e){
      plog('startup backup FAILED: ' + (e && e.message || JSON.stringify(e)));
      msg("Today's automatic backup didn't complete. Your data is fine, but please export a manual backup from Settings.", 'error');
    });
    setTimeout(checkForUpdate, 5000);
  };

  /* ---------- safe close: finish saves -> backup -> close DB -> exit ---------- */
  var closing = false;
  window.__TAURI__.window.getCurrentWindow().onCloseRequested(function(event){
    if(!window.__clothAppStarted) return;      // still on licence/login screen: close at once
    if(closing){ event.preventDefault(); return; }
    closing = true;
    event.preventDefault();
    plog('close-requested');
    var work = Promise.race([
      dbIdle().then(function(){ return enqueueBackup(function(){ return writeBackup(false); }); })
        .then(function(){ plog('end-of-day backup ok'); })
        .catch(function(e){ plog('end-of-day backup FAILED: ' + (e && e.message || JSON.stringify(e))); }),
      sleep(8000).then(function(){ plog('save/backup timed out at 8s'); })
    ]);
    work.then(function(){
      return Promise.race([
        dbShutdown().then(function(){ plog('db closed'); }).catch(function(e){ plog('db close FAILED: ' + (e && e.message || e)); }),
        sleep(2500)
      ]);
    }).then(function(){
      return window.__TAURI__.process.exit(0);
    }).catch(function(e){
      plog('process.exit failed, using destroy(): ' + (e && e.message || e));
      return window.__TAURI__.window.getCurrentWindow().destroy();
    });
  }).catch(function(e){ console.error('could not register close handler', e); });

  /* ---------- automatic updates ---------- */
  function checkForUpdate(){
    if(!(window.__TAURI__.updater && window.__TAURI__.process)) return;
    window.__TAURI__.updater.check().then(function(update){
      if(!update) return;
      var yes = confirm('A new version (' + update.version + ') is available.\n\nUpdate now? The app will download it and restart.\n\nChoose Cancel to keep working; you will be asked again next time.');
      if(!yes){ msg('Update postponed.'); return; }
      msg('Downloading update ' + update.version + '...');
      return update.downloadAndInstall().then(function(){ msg('Update installed. Restarting...'); return window.__TAURI__.process.relaunch(); });
    }).catch(function(e){ console.error('Update check failed', e); });
  }
})();
