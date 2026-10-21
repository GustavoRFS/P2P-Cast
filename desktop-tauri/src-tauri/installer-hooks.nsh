; Start P2P-Cast with Windows. The app opens straight into the tray, and that is what keeps the
; global shortcuts registered, so autostart is what makes them usable without opening anything.
;
; The value goes to HKCU because the NSIS bundle installs per user (installMode defaults to
; currentUser). A perMachine install would write this into the elevated account's hive instead,
; so switch to HKLM here if that ever changes.

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "P2P-Cast" '"$INSTDIR\${MAINBINARYNAME}.exe"'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "P2P-Cast"
!macroend
