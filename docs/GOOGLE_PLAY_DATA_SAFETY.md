# Google Play Data Safety & Release Checklist (Fase 4)

1. **Data Collection & Sharing:**
   - **Data collected by developer servers:** None (local-first; sync runs directly between user's Android and Linux PC over LAN/Tailscale).
   - **Optional 3rd-party AI processor:** User-configured Google Gemini API (user's own API key).
2. **Sensitive Permissions Disclosure:**
   - `USE_EXACT_ALARM` / `SCHEDULE_EXACT_ALARM`: Core task alarm & calendar reminder clock (`AlarmRingingActivity` + `ExactAlarmReceiver`).
   - `USE_FULL_SCREEN_INTENT`: Full-screen Hard Alarm alert on lock screen (`AlarmRingingActivity`).
   - `POST_NOTIFICATIONS` & `RECEIVE_BOOT_COMPLETED`: Soft reminders & re-arming scheduled task alarms after device reboot.
3. **Google Play Closed Test Tracker (Personal Developer Account Rule):**
   - [ ] Internal Testing Track verified on physical Android device (`>= 99%` crash-free sessions).
   - [ ] Recruit `>= 12` opted-in testers for Closed Testing track.
   - [ ] Maintain `>= 12` active testers for **14 consecutive days** before applying for Production access.
