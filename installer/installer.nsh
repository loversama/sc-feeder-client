; Included by electron-builder (nsis.include).
; Since 0.3.4 the app ships as resources\app.asar. Installs before that used a loose resources\app
; folder; Electron prefers that folder over app.asar, so a leftover copy must never survive an update.
!macro customInstall
  RMDir /r "$INSTDIR\resources\app"
!macroend
