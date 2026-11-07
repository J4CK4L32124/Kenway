; Inno Setup script for Kenway.
; Build: install Inno Setup (jrsoftware.org/isdl.php), then right-click this
; file -> Compile (or open it in the Inno Setup IDE and press F9). The output
; is installer\Output\Kenway-Setup.exe — that's the file you share.
;
; The installer is tiny: it ships only the launcher + config, NOT the 360 MB
; exe. On first launch the launcher downloads the latest release from GitHub.
; It installs per-user (no admin) into %LOCALAPPDATA%\Kenway.

#define MyAppName "Kenway"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Kenway"

[Setup]
AppId={{A7C3F1E2-9B4D-4C8A-9E2F-KENWAY000001}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Kenway
DisableProgramGroupPage=yes
DisableDirPage=yes
PrivilegesRequired=lowest
OutputBaseFilename=Kenway-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=Kenway
; Use the real exe for the uninstall icon once it exists.
UninstallDisplayIcon={app}\kenway.exe

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"

[Files]
Source: "..\updater\launcher.ps1";       DestDir: "{app}"; Flags: ignoreversion
; Keep the user's repo setting / version marker across reinstalls.
Source: "..\updater\update.config.json";  DestDir: "{app}"; Flags: onlyifdoesntexist
Source: "seed-version.json";              DestDir: "{app}"; DestName: "version.json"; Flags: onlyifdoesntexist
Source: "..\README.md";                   DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\Kenway"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\launcher.ps1"""; WorkingDir: "{app}"; IconFilename: "{app}\kenway.exe"
Name: "{autodesktop}\Kenway";  Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\launcher.ps1"""; WorkingDir: "{app}"; IconFilename: "{app}\kenway.exe"; Tasks: desktopicon

[Run]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\launcher.ps1"""; WorkingDir: "{app}"; Description: "Launch Kenway now"; Flags: postinstall nowait skipifsilent

[UninstallDelete]
; Remove everything the launcher downloaded/created (but not by default the
; user's config/data — see note in SETUP.md if you want those gone too).
Type: files; Name: "{app}\kenway.exe"
Type: files; Name: "{app}\kenway-previous.exe"
Type: filesandordirs; Name: "{app}\plugins"
