package com.example.releasedemo

import android.content.Context
import android.content.SharedPreferences

class AuthManager(context: Context) {
    private val prefs: SharedPreferences =
        context.getSharedPreferences("auth_prefs", Context.MODE_PRIVATE)

    fun isLoggedIn(): Boolean = prefs.getBoolean("isLoggedIn", false)

    fun login(username: String) {
        prefs.edit()
            .putBoolean("isLoggedIn", true)
            .putString("username", username)
            .apply()
    }

    fun logout() {
        prefs.edit().clear().apply()
    }

    fun currentUser(): String? = prefs.getString("username", null)
}
