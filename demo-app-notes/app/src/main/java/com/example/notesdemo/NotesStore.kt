package com.example.notesdemo

import android.content.Context

class NotesStore(context: Context) {
    private val prefs = context.getSharedPreferences("notes_data", Context.MODE_PRIVATE)

    fun getAll(): List<String> {
        val notes = mutableListOf<String>()
        var i = 0
        while (true) {
            val note = prefs.getString("note_$i", null) ?: break
            notes.add(note)
            i++
        }
        return notes
    }

    fun add(note: String) {
        val count = getAll().size
        prefs.edit().putString("note_$count", note).apply()
    }
}
