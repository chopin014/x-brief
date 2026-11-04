#!/usr/bin/env python3
"""Install X Brief in an existing per-user Zen application using local AutoConfig.

This registers this one local extension through Firefox's built-in-addon API.
It does not change extension signing requirements or edit profile databases.
Restart Zen after running. The browser application directory must be writable.
"""
import argparse,hashlib,json,os,shutil,tempfile,zipfile
from datetime import datetime
from pathlib import Path

def install(xpi,application,profile,data):
    application=application.expanduser().resolve();profile=profile.expanduser().resolve();data=data.expanduser().resolve()
    with zipfile.ZipFile(xpi) as z:
        manifest=json.loads(z.read('manifest.json'))
        if manifest['browser_specific_settings']['gecko']['id']!='x-brief@local.gabriel':raise ValueError('Unexpected extension ID')
        for name in z.namelist():
            if name.startswith('/') or '..' in Path(name).parts:raise ValueError('Unsafe archive path')
        digest=hashlib.sha256(xpi.read_bytes()).hexdigest()[:12]
        release=data/'releases'/(manifest['version']+'-'+digest)
        if not release.exists():
            release.mkdir(parents=True);z.extractall(release)
    defaults=application/'defaults';prefdir=defaults/'pref';config=application/'x-brief.cfg';pref=prefdir/'x-brief-autoconfig.js'
    for candidate in prefdir.glob('*.js'):
        if candidate.name!='x-brief-autoconfig.js' and 'general.config.filename' in candidate.read_text(errors='replace'):
            raise RuntimeError('Another AutoConfig is configured; preserve it and integrate X Brief explicitly.')
    backup=data/'install-backups'/datetime.now().strftime('%Y%m%d-%H%M%S');backup.mkdir(parents=True,exist_ok=True)
    metadata={'application':str(application),'profile':str(profile),'release':str(release),'defaultsSymlink':str(defaults.readlink()) if defaults.is_symlink() else None}
    for p in [config,pref]:
        if p.exists():shutil.copy2(p,backup/p.name)
    (backup/'installation.json').write_text(json.dumps(metadata,indent=2)+'\n')
    if defaults.is_symlink():
        staged=application/'defaults.x-brief-staging'
        if staged.exists():raise RuntimeError('A previous staging folder exists')
        shutil.copytree(defaults.resolve(),staged,symlinks=True);defaults.unlink();staged.rename(defaults)
    prefdir.mkdir(parents=True,exist_ok=True)
    pref.write_text('// Local X Brief startup integration.\npref("general.config.filename", "x-brief.cfg");\npref("general.config.obscure_value", 0);\npref("general.config.sandbox_enabled", false);\n')
    code='''// X Brief: register one local resource before Firefox starts its add-ons.
(function() {
  const Cc=Components.classes, Ci=Components.interfaces;
  const io=Cc['@mozilla.org/network/io-service;1'].getService(Ci.nsIIOService);
  io.getProtocolHandler('resource').QueryInterface(Ci.nsIResProtocolHandler)
    .setSubstitution('x-brief-local',io.newURI(RELEASE_URI));
  const obs=Cc['@mozilla.org/observer-service;1'].getService(Ci.nsIObserverService);
  const listener={observe() {
    obs.removeObserver(listener,'final-ui-startup');
    const dirs=Cc['@mozilla.org/file/directory_service;1'].getService(Ci.nsIProperties);
    if(dirs.get('ProfD',Ci.nsIFile).path!==PROFILE_PATH)return;
    const {AddonManager}=ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
    AddonManager.getAddonByID('x-brief@local.gabriel').then(addon=>{
      if(!addon || addon.version!==VERSION)
        return AddonManager.installBuiltinAddon('resource://x-brief-local/');
    }).catch(error=>Components.utils.reportError('X Brief startup: '+error));
  }};
  obs.addObserver(listener,'final-ui-startup');
})();
'''
    code=code.replace('RELEASE_URI',json.dumps(release.as_uri()+'/')).replace('PROFILE_PATH',json.dumps(str(profile))).replace('VERSION',json.dumps(manifest['version']))
    config.write_text(code);config.chmod(0o600)
    (data/'installation.json').write_text(json.dumps(metadata,indent=2)+'\n')
    print(json.dumps({'release':str(release),'config':str(config),'backup':str(backup),'restartRequired':True},indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--xpi',type=Path,required=True);p.add_argument('--application',type=Path,required=True);p.add_argument('--profile',type=Path,required=True);p.add_argument('--data',type=Path,default=Path.home()/'.local/share/x-brief')
    a=p.parse_args();install(a.xpi,a.application,a.profile,a.data)
