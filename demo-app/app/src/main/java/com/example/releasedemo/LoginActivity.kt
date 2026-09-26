package com.example.releasedemo

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.EditText

class LoginActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_login)

        val username = findViewById<EditText>(R.id.usernameInput)
        val loginButton = findViewById<Button>(R.id.loginButton)

        loginButton.setOnClickListener {
            val user = username.text.toString().ifBlank { "demo" }
            AuthManager(this).login(user)
            startActivity(Intent(this, DashboardActivity::class.java))
            finish()
        }
    }
}
