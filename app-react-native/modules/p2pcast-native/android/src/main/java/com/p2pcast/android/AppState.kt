package com.p2pcast.android

/**
 * Mirrors src/types.ts from the web app (StreamMode, AppError) so the two
 * clients reason about connection state the same way.
 */
enum class StreamMode {
    IDLE,
    STARTING,
    BROADCASTING,
    CONNECTING,
    WATCHING,
    ERROR,
}

data class AppError(
    val title: String,
    val message: String,
    val details: String? = null,
)
