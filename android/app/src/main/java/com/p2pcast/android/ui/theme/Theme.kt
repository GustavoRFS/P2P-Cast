package com.p2pcast.android.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// Loosely matches the web app's dark, purple/teal accent palette
// (src/index.css) so both clients feel like the same product.
private val Background = Color(0xFF0B0F1A)
private val Surface = Color(0xFF141B2E)
private val Primary = Color(0xFF6D5EF8)
private val Secondary = Color(0xFF22D3B8)
private val OnDark = Color(0xFFEFF2FF)

private val DarkColors = darkColorScheme(
    primary = Primary,
    secondary = Secondary,
    background = Background,
    surface = Surface,
    onPrimary = Color.White,
    onBackground = OnDark,
    onSurface = OnDark,
    error = Color(0xFFFF6B6B),
)

private val LightColors = lightColorScheme(
    primary = Primary,
    secondary = Secondary,
    error = Color(0xFFD64545),
)

@Composable
fun P2PCastTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        typography = P2PCastTypography,
        content = content,
    )
}
