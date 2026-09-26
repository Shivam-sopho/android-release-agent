# Release Regression Report

**Build under test:** `com.example.releasedemo` — old.apk (v1.0) vs new.apk (v2.0)
**Method:** compiled-binary diff -> targeted journey selection -> live emulator execution -> evidence -> verdict
**Note:** this run was driven by `scripts/run-manual-demo.mjs` (deterministic, scripted) calling
the exact same MCP tools the autonomous LLM agent uses, while a working model-provider key was
still being provisioned. Every screenshot/logcat/diff below is a real tool execution against the
live emulator — nothing here is fabricated or hand-written.

## What changed (from `diff_apks`)

See the diff output in the log below — `AuthManager`'s SharedPreferences file/keys were renamed
between builds (`session_prefs`/`is_logged_in` -> `auth_prefs`/`isLoggedIn`).

## Journeys tested

1. **Fresh login on old.apk** — sanity baseline.
2. **Existing session survives an in-place upgrade** — login on old.apk, force-stop, install
   new.apk with `-r` (upgrade semantics, app data preserved), relaunch, check final screen.

## Result

- Journey A (fresh login, old.apk): reached `DashboardActivity` as expected.
- Journey B (upgrade with existing session, new.apk): reached **focused_window: mCurrentFocus=Window{beb4273 u0 com.example.releasedemo/com.example.releasedemo.LoginActivity}**

🔴 **REGRESSION DETECTED** — a logged-in user is bounced back to the Login screen after an in-place app upgrade, even though their session was never explicitly cleared. Root cause: `AuthManager`'s SharedPreferences file/keys were renamed, so `isLoggedIn()` reads from a file that has no data for pre-upgrade users.

| Before (old.apk, logged in) | After upgrade to new.apk, relaunch |
|---|---|
| ![logged in on old build](A2_old_after_login.png) | ![bounced to login after upgrade](B_after_upgrade_relaunch.png) |
| Dashboard, "Welcome, demo" | **Regression:** back on the Login screen |

## Verdict

**REGRESSION_DETECTED**

Evidence (screenshots + logcat) is in `evidence/` alongside this report:
`A2_old_after_login.png`, `B_after_upgrade_relaunch.png`, and the `*.logcat.txt` files.

---

## Full tool execution log

### diff_apks({"old_apk":"/media/shivam/Developmet Work1/Hackathons/android-release-agent/artifacts/old.apk","new_apk":"/media/shivam/Developmet Work1/Hackathons/android-release-agent/artifacts/new.apk"})

```
## APK diff (compiled binary, not source)
classes.dex: 2336108 -> 2336108 bytes (delta 0) [identical size]
classes2.dex: 1928 -> 1928 bytes (delta 0) [identical size]
classes3.dex: 6476 -> 6452 bytes (delta -24)

### AndroidManifest.xml diff
```
--- /tmp/apkdiff-wu8o90/old_manifest.txt	2026-09-26 13:34:17.501654720 +0530
+++ /tmp/apkdiff-wu8o90/new_manifest.txt	2026-09-26 13:34:17.501654720 +0530
@@ -1,7 +1,7 @@
 N: android=http://schemas.android.com/apk/res/android
   E: manifest (line=2)
-    A: android:versionCode(0x0101021b)=(type 0x10)0x1
-    A: android:versionName(0x0101021c)="1.0" (Raw: "1.0")
+    A: android:versionCode(0x0101021b)=(type 0x10)0x2
+    A: android:versionName(0x0101021c)="2.0" (Raw: "2.0")
     A: android:compileSdkVersion(0x01010572)=(type 0x10)0x22
     A: android:compileSdkVersionCodename(0x01010573)="14" (Raw: "14")
     A: package="com.example.releasedemo" (Raw: "com.example.releasedemo")

```

### classes.dex string-pool diff (reveals changed string literals — e.g. SharedPreferences keys/file names, constants)
```
--- classes3.dex string-pool diff ---
--- /tmp/apkdiff-wu8o90/classes3.dex.old.strings	2026-09-26 13:34:17.654679928 +0530
+++ /tmp/apkdiff-wu8o90/classes3.dex.new.strings	2026-09-26 13:34:17.654679928 +0530
@@ -15,6 +15,7 @@
 apply
 auth
 AuthManager.kt
+auth_prefs
 checkNotNullExpressionValue
 checkNotNullParameter
 clear
@@ -36,7 +37,6 @@
 getText
 <init>
 isBlank
-is_logged_in
 isLoggedIn
 Kotlin
 kotlin/jvm/internal/FakeKt
@@ -54,7 +54,7 @@
 Landroid/widget/EditText;
 Landroid/widget/TextView;
 %Lcom/example/releasedemo/AuthManager;
-~~~{"Lcom/example/releasedemo/AuthManager;":"52b50d4a","Lcom/example/releasedemo/DashboardActivity$$ExternalSyntheticLambda0;":"fa6d163f","Lcom/example/releasedemo/DashboardActivity;":"6f6a2ccd","Lcom/example/releasedemo/LoginActivity$$ExternalSyntheticLambda0;":"46a58c3fb","Lcom/example/releasedemo/LoginActivity;":"1d901ffb","Lcom/example/releasedemo/SplashActivity;":"7526fd37"}
+~~~{"Lcom/example/releasedemo/AuthManager;":"a4244d02","Lcom/example/releasedemo/DashboardActivity$$ExternalSyntheticLambda0;":"fa6d163f","Lcom/example/releasedemo/DashboardActivity;":"6f6a2ccd","Lcom/example/releasedemo/LoginActivity$$ExternalSyntheticLambda0;":"46a58c3fb","Lcom/example/releasedemo/LoginActivity;":"1d901ffb","Lcom/example/releasedemo/SplashActivity;":"7526fd37"}
 +Lcom/example/releasedemo/DashboardActivity;
 'Lcom/example/releasedemo/LoginActivity;
 Lcom/example/releasedemo/R$id;
@@ -82,9 +82,8 @@
 prefs
 putBoolean
 	putString
-rYixK<
+qYixK<
 savedInstanceState
-session_prefs
 setContentView
 setOnClickListener
 setText

```
```


### JOURNEY

```
A: fresh login on old.apk (baseline, currently shipped)
```


### adb_install({"apk_path":"/media/shivam/Developmet Work1/Hackathons/android-release-agent/artifacts/old.apk"})

```
Performing Streamed Install
Success

```


### adb_logcat_clear({})

```
logcat cleared
```


### adb_launch({"package_id":"com.example.releasedemo"})

```
launched com.example.releasedemo
```


### adb_screenshot({"label":"A1_old_fresh_after_launch"})

```
saved /media/shivam/Developmet Work1/Hackathons/android-release-agent/evidence/A1_old_fresh_after_launch.png
```


### adb_dump_ui({})

```
focused_window: mCurrentFocus=Window{42310d3 u0 com.example.releasedemo/com.example.releasedemo.LoginActivity}
elements:
text="" id="android:id/content" bounds=[0,142][1080,2361]
text="Sign in" id="" bounds=[446,975][634,1060]
text="Username" id="com.example.releasedemo:id/usernameInput" bounds=[63,1123][1017,1241]
text="Password" id="com.example.releasedemo:id/passwordInput" bounds=[63,1241][1017,1359]
text="LOG IN" id="com.example.releasedemo:id/loginButton" bounds=[63,1401][1017,1527]
text="" id="android:id/statusBarBackground" bounds=[0,0][1080,142]
text="" id="android:id/navigationBarBackground" bounds=[0,2361][1080,2424]
```


### adb_tap({"x":540,"y":1464})

```
tapped (540, 1464)
```


### adb_screenshot({"label":"A2_old_after_login"})

```
saved /media/shivam/Developmet Work1/Hackathons/android-release-agent/evidence/A2_old_after_login.png
```


### adb_dump_ui({})

```
focused_window: mCurrentFocus=Window{8f5ddf u0 com.example.releasedemo/com.example.releasedemo.DashboardActivity}
elements:
text="" id="android:id/content" bounds=[0,142][1080,2361]
text="Welcome, demo" id="com.example.releasedemo:id/welcomeText" bounds=[333,1118][747,1196]
text="LOG OUT" id="com.example.releasedemo:id/logoutButton" bounds=[63,1259][1017,1385]
text="" id="android:id/statusBarBackground" bounds=[0,0][1080,142]
text="" id="android:id/navigationBarBackground" bounds=[0,2361][1080,2424]
```


### adb_logcat_dump({"label":"A_old_login"})

```
saved /media/shivam/Developmet Work1/Hackathons/android-release-agent/evidence/A_old_login.logcat.txt (1143 lines)
```


### JOURNEY

```
B: existing session survives upgrade (old.apk login -> force-stop -> install new.apk -r -> relaunch)
```


### adb_force_stop({"package_id":"com.example.releasedemo"})

```
force-stopped com.example.releasedemo
```


### adb_install({"apk_path":"/media/shivam/Developmet Work1/Hackathons/android-release-agent/artifacts/new.apk"})

```
Performing Streamed Install
Success

```


### adb_logcat_clear({})

```
logcat cleared
```


### adb_launch({"package_id":"com.example.releasedemo"})

```
launched com.example.releasedemo
```


### adb_screenshot({"label":"B_after_upgrade_relaunch"})

```
saved /media/shivam/Developmet Work1/Hackathons/android-release-agent/evidence/B_after_upgrade_relaunch.png
```


### adb_dump_ui({})

```
focused_window: mCurrentFocus=Window{beb4273 u0 com.example.releasedemo/com.example.releasedemo.LoginActivity}
elements:
text="" id="android:id/content" bounds=[0,142][1080,2361]
text="Sign in" id="" bounds=[446,975][634,1060]
text="Username" id="com.example.releasedemo:id/usernameInput" bounds=[63,1123][1017,1241]
text="Password" id="com.example.releasedemo:id/passwordInput" bounds=[63,1241][1017,1359]
text="LOG IN" id="com.example.releasedemo:id/loginButton" bounds=[63,1401][1017,1527]
text="" id="android:id/statusBarBackground" bounds=[0,0][1080,142]
text="" id="android:id/navigationBarBackground" bounds=[0,2361][1080,2424]
```


### adb_logcat_dump({"label":"B_after_upgrade"})

```
saved /media/shivam/Developmet Work1/Hackathons/android-release-agent/evidence/B_after_upgrade.logcat.txt (950 lines)
```

