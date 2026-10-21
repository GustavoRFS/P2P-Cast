package com.p2pcast.android.signaling

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.webrtc.IceCandidate
import org.webrtc.SessionDescription

/** Builds/reads the OFFER/ANSWER/CANDIDATE payload shapes the signaling
 * socket carries — see PeerSignalingClient's kdoc for context. */

// Field set verified directly against node_modules/peerjs/dist/peerjs.js
// (Negotiator._makeOffer/_makeAnswer): no "browser" field on the wire for
// OFFER/ANSWER (that field belongs to a different, unrelated API call) and
// data offers additionally carry "label" (defaults to connectionId, same as
// the real DataConnection does when the caller doesn't set one explicitly).
fun buildOfferPayload(
    sdp: SessionDescription,
    connType: String,
    connectionId: String,
    metadata: JsonObject? = null,
    label: String? = null,
    serialization: String? = null,
    reliable: Boolean? = null,
): JsonObject = buildJsonObject {
    put("sdp", buildJsonObject { put("type", "offer"); put("sdp", sdp.description) })
    put("type", connType)
    put("connectionId", connectionId)
    if (metadata != null) put("metadata", metadata)
    if (connType == PeerConnectionType.DATA) {
        put("label", label ?: connectionId)
        if (serialization != null) put("serialization", serialization)
        if (reliable != null) put("reliable", reliable)
    }
}

fun buildAnswerPayload(sdp: SessionDescription, connType: String, connectionId: String): JsonObject = buildJsonObject {
    put("sdp", buildJsonObject { put("type", "answer"); put("sdp", sdp.description) })
    put("type", connType)
    put("connectionId", connectionId)
}

fun buildCandidatePayload(candidate: IceCandidate, connType: String, connectionId: String): JsonObject = buildJsonObject {
    put(
        "candidate",
        buildJsonObject {
            put("candidate", candidate.sdp)
            put("sdpMLineIndex", candidate.sdpMLineIndex)
            put("sdpMid", candidate.sdpMid ?: "")
        },
    )
    put("type", connType)
    put("connectionId", connectionId)
}

fun parseSdp(payload: JsonObject): SessionDescription {
    val sdpObj = payload["sdp"]!!.jsonObject
    val typeStr = sdpObj["type"]!!.jsonPrimitive.content
    val sdpStr = sdpObj["sdp"]!!.jsonPrimitive.content
    val type = if (typeStr == "answer") SessionDescription.Type.ANSWER else SessionDescription.Type.OFFER
    return SessionDescription(type, sdpStr)
}

fun parseCandidate(payload: JsonObject): IceCandidate {
    val c = payload["candidate"]!!.jsonObject
    val sdpMid = c["sdpMid"]?.jsonPrimitive?.contentOrNull
    val sdpMLineIndex = c["sdpMLineIndex"]?.jsonPrimitive?.intOrNull ?: 0
    val candidateStr = c["candidate"]!!.jsonPrimitive.content
    return IceCandidate(sdpMid, sdpMLineIndex, candidateStr)
}

fun connectionIdOf(payload: JsonObject): String? = payload["connectionId"]?.jsonPrimitive?.contentOrNull
fun connTypeOf(payload: JsonObject): String? = payload["type"]?.jsonPrimitive?.contentOrNull
fun serializationOf(payload: JsonObject): String? = payload["serialization"]?.jsonPrimitive?.contentOrNull
fun metadataOf(payload: JsonObject): JsonObject? = payload["metadata"] as? JsonObject
