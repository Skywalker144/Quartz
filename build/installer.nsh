; Quartz — custom NSIS uninstall step.
; electron-builder's uninstaller removes the program files, shortcuts and its registry keys, but intentionally
; LEAVES the per-user data folder (%APPDATA%\Quartz — conversations, settings, API keys, backups, cache; plus the
; legacy %APPDATA%\ChatBox) so a reinstall keeps everything. Offer to delete it too, for a fully clean uninstall.
; Default = keep (avoid data loss).
; Skipped during an in-place update (electron-updater uninstalls the old build silently — never wipe data then).
!macro customUnInstall
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION "是否同时删除 Quartz 的全部数据？$\r$\n（对话记录、设置、API Key、备份等）$\r$\n$\r$\n选择「否」将保留数据，重新安装后可继续使用。" /SD IDNO IDNO quartzKeepData
      RMDir /r "$APPDATA\Quartz"
      RMDir /r "$LOCALAPPDATA\Quartz"
      RMDir /r "$APPDATA\ChatBox"
      RMDir /r "$LOCALAPPDATA\ChatBox"
    quartzKeepData:
  ${endIf}
!macroend
