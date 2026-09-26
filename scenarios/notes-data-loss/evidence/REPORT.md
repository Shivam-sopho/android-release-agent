# Release Regression Report — Notes app (data loss)

## 🔴 REGRESSION_DETECTED

**Build under test:** `com.example.notesdemo` — old.apk (v1.0) vs new.apk (v2.0)
**Method:** compiled-binary diff → impact analysis → targeted journey execution on a live emulator → evidence capture → verdict

> Second demo scenario, same pipeline as the auth-app report: driven by
> [`mcp-server/run-notes-demo.mjs`](../mcp-server/run-notes-demo.mjs) calling the real MCP
> tools, while a funded model-provider key was still pending. Same tools, same harness,
> different app — showing the pipeline isn't tied to one app's specific bug.

## What changed

<details>
<summary>Full diff_apks output</summary>

## APK diff (compiled binary, not source)
classes.dex: 2336108 -> 2336108 bytes (delta 0) [identical size]
classes2.dex: 1632 -> 1632 bytes (delta 0) [identical size]
classes3.dex: 6940 -> 6036 bytes (delta -904)

### AndroidManifest.xml diff
```
--- /tmp/apkdiff-wQBVsb/old_manifest.txt	2026-09-26 15:34:46.879516403 +0530
+++ /tmp/apkdiff-wQBVsb/new_manifest.txt	2026-09-26 15:34:46.879516403 +0530
@@ -1,7 +1,7 @@
 N: android=http://schemas.android.com/apk/res/android
   E: manifest (line=2)
-    A: android:versionCode(0x0101021b)=(type 0x10)0x1
-    A: android:versionName(0x0101021c)="1.0" (Raw: "1.0")
+    A: android:versionCode(0x0101021b)=(type 0x10)0x2
+    A: android:versionName(0x0101021c)="2.0" (Raw: "2.0")
     A: android:compileSdkVersion(0x01010572)=(type 0x10)0x22
     A: android:compileSdkVersionCodename(0x01010573)="14" (Raw: "14")
     A: package="com.example.notesdemo" (Raw: "com.example.notesdemo")

```

### classes.dex string-pool diff (reveals changed string literals — e.g. SharedPreferences keys/file names, constants)
```
--- classes3.dex string-pool diff ---
--- /tmp/apkdiff-wQBVsb/classes3.dex.old.strings	2026-09-26 15:34:47.049518262 +0530
+++ /tmp/apkdiff-wQBVsb/classes3.dex.new.strings	2026-09-26 15:34:47.049518262 +0530
@@ -1,58 +1,39 @@
- $i$a$-filter-NotesStore$getAll$1
 ,$i$a$-ifBlank-MainActivity$onCreate$1$text$1
-$i$f$filter
-$i$f$filterTo
 $input
 $Lcom/example/notesdemo/MainActivity;
 $notesList
 &$r8$lambda$QV44Vm_QRsrdNWkUoiaDYvp6zBM
 &$r8$lambda$-Z8qhxS_UIT5_rRkMoZl9PgSDTI
 $store
-$this$filter$iv
-$this$filterTo$iv$iv
-10#1:19
-10#1:20,2
-1#1,18:1
 1#1,34:1
 1#2:35
 + 1 MainActivity.kt
-+ 1 NotesStore.kt
-+ 2 _Collections.kt
 + 2 fake.kt
-774#2:19
-865#2,2:20
 activity_main
-	all_notes
 	app_debug
 append
 apply
-Bn0 
 checkNotNullParameter
 clear
 com/example/notesdemo/MainActivity
-com/example/notesdemo/NotesStore
 context
+count
 currentTimeMillis
 D8$$SyntheticClass
-destination$iv$iv
 e~~D8{"backend":"dex","compilation-mode":"debug","has-checksums":true,"min-api":24,"version":"8.7.18"}
 edit
-element$iv$iv
 findViewById
 getAll
 getSharedPreferences
 	getString
 getText
-hasNext
 <init>
 input
 invoke
 isBlank
 isEmpty
-iterator
 joinToString$default
 Kotlin
-kotlin/collections/CollectionsKt___CollectionsKt
 kotlin/jvm/internal/FakeKt
 kotlin.jvm.PlatformType
 Landroid/app/Activity;
@@ -68,24 +49,20 @@
 Landroid/widget/EditText;
 Landroid/widget/TextView;
 >Lcom/example/notesdemo/MainActivity$$ExternalSyntheticLambda0;
-~~~{"Lcom/example/notesdemo/MainActivity$$ExternalSyntheticLambda0;":"3c93e3396","Lcom/example/notesdemo/MainActivity$$ExternalSyntheticLambda1;":"-363c96c85","Lcom/example/notesdemo/MainActivity;":"a0922ae5","Lcom/example/notesdemo/NotesStore;":"8961cecd"}
+~~~{"Lcom/example/notesdemo/MainActivity$$ExternalSyntheticLambda0;":"3c93e3396","Lcom/example/notesdemo/MainActivity$$ExternalSyntheticLambda1;":"-363c96c85","Lcom/example/notesdemo/MainActivity;":"a0922ae5","Lcom/example/notesdemo/NotesStore;":"f3062d96"}
 >Lcom/example/notesdemo/MainActivity$$ExternalSyntheticLambda1;
 "Lcom/example/notesdemo/NotesStore;
 Lcom/example/notesdemo/R$id;
  Lcom/example/notesdemo/R$layout;
 Ldalvik/annotation/Signature;
 (Ldalvik/annotation/SourceDebugExtension;
-length
 Ljava/lang/CharSequence;
 Ljava/lang/Iterable;
 Ljava/lang/Object;
-[Ljava/lang/String;
 Ljava/lang/String;
 Ljava/lang/StringBuilder;
 Ljava/lang/System;
 Ljava/util/ArrayList;
-Ljava/util/Collection;
-Ljava/util/Iterator;
 Ljava/util/List;
 Ljava/util/List<
 "Lkotlin/collections/CollectionsKt;
@@ -94,23 +71,22 @@
 Lkotlin/Metadata;
 Lkotlin/text/StringsKt;
 LLLLLILLIL
-LLLZIIL
 MainActivity.kt
-next
+mpEhp,`
 No notes yet.
 note
+note_
 Note 
 	noteInput
 notes
+notes_data
 	notesList
-notes_store
 NotesStore.kt
 onClick
 onCreate
 onCreate$lambda$2
 onCreate$refresh
 onCreate$refresh$lambda$0
-plus
 prefs
 	putString
 saveButton
@@ -118,14 +94,12 @@
 setContentView
 setOnClickListener
 setText
+size
 *S Kotlin
-*S KotlinDebug
 SMAP
-split$default
 store
 text
 toString
-updated
 value
 VLLL
 VLLLL

```

</details>

**In plain English:** one class changed — `NotesStore` — both the SharedPreferences file name
and the key scheme changed in the same release.

## Journeys tested

| # | Journey | Expected | Actual | Result |
|---|---|---|---|---|
| J1 | Save 1 note on old.apk | Note is listed | • Note 327 | ✅ PASS |
| J2 | Upgrade to new.apk, reopen | Same note still listed | No notes yet. | 🔴 **FAIL** |

<table><tr>
<td align="center"><img src="J1_note_saved.png" width="260"><br><sub>1 note saved on old.apk</sub></td>
<td align="center"><img src="J2_after_upgrade.png" width="260"><br><sub>Same install, after upgrading to new.apk</sub></td>
</tr></table>

## Root cause

Confirmed by the diff: `NotesStore` switched from a single delimited-string value under
`notes_store`/`all_notes` to indexed keys (`note_0`, `note_1`, ...) under a renamed file
`notes_data`, with no migration. The note saved in J1 is still physically on the device — in
the old file, under the old key — but the new code only ever looks in the new file, so it reads
nothing and shows "No notes yet."

This is the same *class* of bug as the auth-app scenario (a SharedPreferences file/key rename
with no migration on upgrade) hitting a completely different feature — which is exactly why the
agent looks at the compiled diff instead of assuming what "the bug" looks like: the mechanism
repeats, the surface area doesn't.

## Suggested fix

The new build changed both the SharedPreferences **file** (`notes_store` → `notes_data`) and
the **key scheme** (one delimited string → indexed `note_0`, `note_1`, ...) in the same
release, with no migration step. The old data is still on disk — it's just never read.

**Fastest fix (one-time migration on first launch after upgrade):**

```kotlin
class NotesStore(context: Context) {
    private val prefs = context.getSharedPreferences("notes_data", Context.MODE_PRIVATE)

    init {
        if (prefs.getString("note_0", null) == null) migrateFromV1(context)
    }

    private fun migrateFromV1(context: Context) {
        val legacy = context.getSharedPreferences("notes_store", Context.MODE_PRIVATE)
        val old = legacy.getString("all_notes", null) ?: return
        val notes = old.split("\u0001").filter { it.isNotEmpty() }
        val editor = prefs.edit()
        notes.forEachIndexed { i, note -> editor.putString("note_$i", note) }
        editor.apply()
    }

    fun getAll(): List<String> { /* unchanged */ }
    fun add(note: String) { /* unchanged */ }
}
```

**More robust long-term fix:** don't invent a bespoke on-disk format for user data at all — use
Room (SQLite) or DataStore, both of which have first-class schema-migration support, so this
class of bug (rename a storage key/file, forget every existing installed user) can't happen
silently again.


## Verdict

**REGRESSION_DETECTED** — do not ship without the migration above.

---

<details>
<summary>Full raw tool-call log</summary>

### diff_apks({"old_apk":"/media/shivam/Developmet Work1/Hackathons/android-release-agent/scenarios/notes-data-loss/old.apk","new_apk":"/media/shivam/Developmet Work1/Hackathons/android-release-agent/scenarios/notes-data-loss/new.apk"})

````
## APK diff (compiled binary, not source)
classes.dex: 2336108 -> 2336108 bytes (delta 0) [identical size]
classes2.dex: 1632 -> 1632 bytes (delta 0) [identical size]
classes3.dex: 6940 -> 6036 bytes (delta -904)

### AndroidManifest.xml diff
```
--- /tmp/apkdiff-wQBVsb/old_manifest.txt	2026-09-26 15:34:46.879516403 +0530
+++ /tmp/apkdiff-wQBVsb/new_manifest.txt	2026-09-26 15:34:46.879516403 +0530
@@ -1,7 +1,7 @@
 N: android=http://schemas.android.com/apk/res/android
   E: manifest (line=2)
-    A: android:versionCode(0x0101021b)=(type 0x10)0x1
-    A: android:versionName(0x0101021c)="1.0" (Raw: "1.0")
+    A: android:versionCode(0x0101021b)=(type 0x10)0x2
+    A: android:versionName(0x0101021c)="2.0" (Raw: "2.0")
     A: android:compileSdkVersion(0x01010572)=(type 0x10)0x22
     A: android:compileSdkVersionCodename(0x01010573)="14" (Raw: "14")
     A: package="com.example.notesdemo" (Raw: "com.example.notesdemo")

```

### classes.dex string-pool diff (reveals changed string literals — e.g. SharedPreferences keys/file names, constants)
```
--- classes3.dex string-pool diff ---
--- /tmp/apkdiff-wQBVsb/classes3.dex.old.strings	2026-09-26 15:34:47.049518262 +0530
+++ /tmp/apkdiff-wQBVsb/classes3.dex.new.strings	2026-09-26 15:34:47.049518262 +0530
@@ -1,58 +1,39 @@
- $i$a$-filter-NotesStore$getAll$1
 ,$i$a$-ifBlank-MainActivity$onCreate$1$text$1
-$i$f$filter
-$i$f$filterTo
 $input
 $Lcom/example/notesdemo/MainActivity;
 $notesList
 &$r8$lambda$QV44Vm_QRsrdNWkUoiaDYvp6zBM
 &$r8$lambda$-Z8qhxS_UIT5_rRkMoZl9PgSDTI
 $store
-$this$filter$iv
-$this$filterTo$iv$iv
-10#1:19
-10#1:20,2
-1#1,18:1
 1#1,34:1
 1#2:35
 + 1 MainActivity.kt
-+ 1 NotesStore.kt
-+ 2 _Collections.kt
 + 2 fake.kt
-774#2:19
-865#2,2:20
 activity_main
-	all_notes
 	app_debug
 append
 apply
-Bn0 
 checkNotNullParameter
 clear
 com/example/notesdemo/MainActivity
-com/example/notesdemo/NotesStore
 context
+count
 currentTimeMillis
 D8$$SyntheticClass
-destination$iv$iv
 e~~D8{"backend":"dex","compilation-mode":"debug","has-checksums":true,"min-api":24,"version":"8.7.18"}
 edit
-element$iv$iv
 findViewById
 getAll
 getSharedPreferences
 	getString
 getText
-hasNext
 <init>
 input
 invoke
 isBlank
 isEmpty
-iterator
 joinToString$default
 Kotlin
-kotlin/collections/CollectionsKt___CollectionsKt
 kotlin/jvm/internal/FakeKt
 kotlin.jvm.PlatformType
 Landroid/app/Activity;
@@ -68,24 +49,20 @@
 Landroid/widget/EditText;
 Landroid/widget/TextView;
 >Lcom/example/notesdemo/MainActivity$$ExternalSyntheticLambda0;
-~~~{"Lcom/example/notesdemo/MainActivity$$ExternalSyntheticLambda0;":"3c93e3396","Lcom/example/notesdemo/MainActivity$$ExternalSyntheticLambda1;":"-363c96c85","Lcom/example/notesdemo/MainActivity;":"a0922ae5","Lcom/example/notesdemo/NotesStore;":"8961cecd"}
+~~~{"Lcom/example/notesdemo/MainActivity$$ExternalSyntheticLambda0;":"3c93e3396","Lcom/example/notesdemo/MainActivity$$ExternalSyntheticLambda1;":"-363c96c85","Lcom/example/notesdemo/MainActivity;":"a0922ae5","Lcom/example/notesdemo/NotesStore;":"f3062d96"}
 >Lcom/example/notesdemo/MainActivity$$ExternalSyntheticLambda1;
 "Lcom/example/notesdemo/NotesStore;
 Lcom/example/notesdemo/R$id;
  Lcom/example/notesdemo/R$layout;
 Ldalvik/annotation/Signature;
 (Ldalvik/annotation/SourceDebugExtension;
-length
 Ljava/lang/CharSequence;
 Ljava/lang/Iterable;
 Ljava/lang/Object;
-[Ljava/lang/String;
 Ljava/lang/String;
 Ljava/lang/StringBuilder;
 Ljava/lang/System;
 Ljava/util/ArrayList;
-Ljava/util/Collection;
-Ljava/util/Iterator;
 Ljava/util/List;
 Ljava/util/List<
 "Lkotlin/collections/CollectionsKt;
@@ -94,23 +71,22 @@
 Lkotlin/Metadata;
 Lkotlin/text/StringsKt;
 LLLLLILLIL
-LLLZIIL
 MainActivity.kt
-next
+mpEhp,`
 No notes yet.
 note
+note_
 Note 
 	noteInput
 notes
+notes_data
 	notesList
-notes_store
 NotesStore.kt
 onClick
 onCreate
 onCreate$lambda$2
 onCreate$refresh
 onCreate$refresh$lambda$0
-plus
 prefs
 	putString
 saveButton
@@ -118,14 +94,12 @@
 setContentView
 setOnClickListener
 setText
+size
 *S Kotlin
-*S KotlinDebug
 SMAP
-split$default
 store
 text
 toString
-updated
 value
 VLLL
 VLLLL

```
````


### adb_install({"apk_path":"/media/shivam/Developmet Work1/Hackathons/android-release-agent/scenarios/notes-data-loss/old.apk"})

````
Performing Streamed Install
Success

````


### adb_launch({"package_id":"com.example.notesdemo"})

````
launched com.example.notesdemo
````


### adb_screenshot({"label":"J1_empty"})

````
saved /media/shivam/Developmet Work1/Hackathons/android-release-agent/scenarios/notes-data-loss/evidence/J1_empty.png
````


### adb_tap({"x":540,"y":534})

````
tapped (540, 534)
````


### adb_screenshot({"label":"J1_note_saved"})

````
saved /media/shivam/Developmet Work1/Hackathons/android-release-agent/scenarios/notes-data-loss/evidence/J1_note_saved.png
````


### adb_dump_ui({})

````
focused_window: mCurrentFocus=Window{cbe85d1 u0 com.example.notesdemo/com.example.notesdemo.MainActivity}
elements:
text="" id="android:id/content" bounds=[0,142][1080,2361]
text="My Notes" id="" bounds=[63,205][332,290]
text="Write a note..." id="com.example.notesdemo:id/noteInput" bounds=[63,332][1017,450]
text="SAVE NOTE" id="com.example.notesdemo:id/saveButton" bounds=[63,471][1017,597]
text="Saved notes:" id="" bounds=[63,660][302,717]
text="• Note 327" id="com.example.notesdemo:id/notesList" bounds=[63,738][1017,795]
text="" id="android:id/statusBarBackground" bounds=[0,0][1080,142]
text="" id="android:id/navigationBarBackground" bounds=[0,2361][1080,2424]
````


### adb_force_stop({"package_id":"com.example.notesdemo"})

````
force-stopped com.example.notesdemo
````


### adb_logcat_clear({})

````
logcat cleared
````


### adb_install({"apk_path":"/media/shivam/Developmet Work1/Hackathons/android-release-agent/scenarios/notes-data-loss/new.apk"})

````
Performing Streamed Install
Success

````


### adb_launch({"package_id":"com.example.notesdemo"})

````
launched com.example.notesdemo
````


### adb_screenshot({"label":"J2_after_upgrade"})

````
saved /media/shivam/Developmet Work1/Hackathons/android-release-agent/scenarios/notes-data-loss/evidence/J2_after_upgrade.png
````


### adb_dump_ui({})

````
focused_window: mCurrentFocus=Window{5313339 u0 com.example.notesdemo/com.example.notesdemo.MainActivity}
elements:
text="" id="android:id/content" bounds=[0,142][1080,2361]
text="My Notes" id="" bounds=[63,205][332,290]
text="Write a note..." id="com.example.notesdemo:id/noteInput" bounds=[63,332][1017,450]
text="SAVE NOTE" id="com.example.notesdemo:id/saveButton" bounds=[63,471][1017,597]
text="Saved notes:" id="" bounds=[63,660][302,717]
text="No notes yet." id="com.example.notesdemo:id/notesList" bounds=[63,738][1017,795]
text="" id="android:id/statusBarBackground" bounds=[0,0][1080,142]
text="" id="android:id/navigationBarBackground" bounds=[0,2361][1080,2424]
````


### adb_logcat_dump({"label":"J2_logcat"})

````
saved /media/shivam/Developmet Work1/Hackathons/android-release-agent/scenarios/notes-data-loss/evidence/J2_logcat.logcat.txt (1161 lines)
````

</details>
