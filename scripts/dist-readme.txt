TimeTrial {{VERSION}}
=====================
Lap times, leaderboards and challenges for a shared sim-racing rig.
Built {{DATE}}.

Everything stays on this PC. There is no account, no sign-in and no cloud.


WHAT YOU NEED
-------------
* Windows 10 or 11, 64-bit.
* The Microsoft WebView2 runtime. Windows 11 and up-to-date Windows 10 already have it.
  (If the app opens to a blank window, install it from Microsoft: search "WebView2 Runtime".)
* Assetto Corsa EVO, on the same PC, to record laps. (More games will follow.)


TWO WAYS TO RUN IT
------------------
1. Installer:   {{INSTALLER}}
   Double-click it and follow the steps. TimeTrial appears in the Start menu.
   Uninstall from Windows "Installed apps" when you no longer want it.

2. Portable:   TimeTrial-{{VERSION}}-portable.exe   (or TimeTrial.exe inside the zip)
   No install. Copy it anywhere and double-click it. Delete it to remove it.

Windows may say "Windows protected your PC" the first time, because the app isn't code-signed.
Choose "More info", then "Run anyway".


FIRST RUN
---------
1. Start TimeTrial, then start the game. TimeTrial notices the game on its own.
2. Type your name on the Home page and press Enter. That's your driver; laps go to whoever
   is picked. There are no passwords.
3. Drive. Lap times, sectors and a live map appear as you go.

Handy keys while playing:
  F8                 switch driver (or add a new one) without leaving the game
  Ctrl + Shift + H   show / hide the in-game overlay

The in-game overlay draws on top of the game only in "borderless windowed" mode.
Change the layout under "Games & overlay".


USING IT FROM A PHONE OR OTHER PC
---------------------------------
Anyone on the same network can open TimeTrial in a browser: the address is shown at the bottom of
the sidebar, and as a QR code under "Games & overlay". It looks like  http://192.168.x.x:7878

The first time, Windows Firewall asks whether to allow TimeTrial on the network. Choose "Allow" for
the network you are on (private, or public if that is how your work network is set up).
Without that, the app still works on the PC itself but phones can't reach it.

Phones can look at leaderboards and pick the driver. Deleting laps and other maintenance only
works in the desktop app on this PC.


YOUR DATA
---------
Saved in:   %APPDATA%\app.timetrial.desktop
(paste that into the Windows Explorer address bar)

To move your laps to another PC: close TimeTrial on both, then copy the whole folder's
timetrial.db files (timetrial.db, and timetrial.db-wal / timetrial.db-shm if they exist) into the
same place on the other PC. Make sure it has the same TimeTrial version or a newer one:
TimeTrial refuses to open data saved by a newer version rather than risk damaging it.

To keep a backup, copy that folder while TimeTrial is closed.

"Advanced" in the sidebar (desktop app only) shows the version, the data folder, how much is
stored, and has tools to clean up lap times.


IF SOMETHING GOES WRONG
-----------------------
* Nothing happens when I start it: only one copy runs at a time. Check the system tray, or end
  "timetrial.exe" in Task Manager and try again.
* "TimeTrial can't open its data": the data came from a newer version. Install the newer version.
* Phones can't connect: check the Firewall prompt above, and that the phone is on the same network
  (some guest wifi networks block devices from reaching each other).
* Laps aren't being recorded: TimeTrial must be running before you start driving; it ignores laps
  that were already in progress when it started.


CHECKING A COPY
---------------
SHA256SUMS.txt lists a checksum for each file. After copying, run in PowerShell:
  Get-FileHash .\TimeTrial-{{VERSION}}-portable.exe -Algorithm SHA256
and compare it with the line in SHA256SUMS.txt.
