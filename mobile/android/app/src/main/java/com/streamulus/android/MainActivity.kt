package com.streamulus.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.CompositionLocalProvider
import com.streamulus.android.ui.LocalSession
import com.streamulus.android.ui.RootScreen
import com.streamulus.android.ui.theme.StreamulusTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val session = (application as StreamulusApplication).session
        setContent {
            StreamulusTheme {
                CompositionLocalProvider(LocalSession provides session) {
                    RootScreen()
                }
            }
        }
    }
}
