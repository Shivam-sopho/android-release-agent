package com.example.releasedemo

import android.app.Activity
import android.content.Intent
import android.os.Bundle

class SplashActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val auth = AuthManager(this)
        val next = if (auth.isLoggedIn()) DashboardActivity::class.java else LoginActivity::class.java
        startActivity(Intent(this, next))
        finish()
    }
}
