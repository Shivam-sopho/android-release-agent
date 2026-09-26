package com.example.releasedemo

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.TextView

class DashboardActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_dashboard)

        val welcome = findViewById<TextView>(R.id.welcomeText)
        val logoutButton = findViewById<Button>(R.id.logoutButton)
        val auth = AuthManager(this)

        welcome.text = "Welcome, ${auth.currentUser() ?: "user"}"

        logoutButton.setOnClickListener {
            auth.logout()
            startActivity(Intent(this, LoginActivity::class.java))
            finish()
        }
    }
}
