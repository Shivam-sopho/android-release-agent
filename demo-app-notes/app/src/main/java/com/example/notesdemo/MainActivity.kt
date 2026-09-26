package com.example.notesdemo

import android.app.Activity
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView

class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        val input = findViewById<EditText>(R.id.noteInput)
        val saveButton = findViewById<Button>(R.id.saveButton)
        val notesList = findViewById<TextView>(R.id.notesList)
        val store = NotesStore(this)

        fun refresh() {
            val notes = store.getAll()
            notesList.text = if (notes.isEmpty()) "No notes yet." else notes.joinToString("\n\n") { "• $it" }
        }

        saveButton.setOnClickListener {
            val text = input.text.toString().ifBlank { "Note ${System.currentTimeMillis() % 1000}" }
            store.add(text)
            input.text.clear()
            refresh()
        }

        refresh()
    }
}
