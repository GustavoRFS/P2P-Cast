package com.p2pcast.android.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Divider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.p2pcast.android.capture.BITRATE_OPTIONS
import com.p2pcast.android.capture.CameraFacing
import com.p2pcast.android.capture.CaptureSettings
import com.p2pcast.android.capture.CaptureSource
import com.p2pcast.android.capture.FPS_OPTIONS
import com.p2pcast.android.capture.Resolution
import com.p2pcast.android.capture.formatCaptureSettings
import com.p2pcast.android.ui.components.LabeledDropdown
import com.p2pcast.android.ui.components.SectionLabel

@Composable
fun HomeScreen(
    settings: CaptureSettings,
    onSettingsChange: (CaptureSettings) -> Unit,
    onStartBroadcast: () -> Unit,
    onWatch: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    var watchInput by remember { mutableStateOf("") }

    Column(
        modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        Column {
            Text("Compartilhe a tela.", style = MaterialTheme.typography.headlineLarge)
            Text("Fique na call.", style = MaterialTheme.typography.headlineLarge, color = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.height(8.dp))
            Text(
                "Uma transmissão simples para explicar aquela jogada, mostrar um bug ou acompanhar a partida com a galera.",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Text("Configurações da transmissão", style = MaterialTheme.typography.titleMedium)
                Text(formatCaptureSettings(settings), style = MaterialTheme.typography.bodyMedium)

                LabeledDropdown(
                    label = "Fonte da transmissão",
                    options = CaptureSource.entries,
                    selected = settings.source,
                    optionLabel = {
                        when (it) {
                            CaptureSource.SCREEN -> "Tela"
                            CaptureSource.CAMERA -> "Câmera"
                            CaptureSource.BOTH -> "Tela + câmera"
                        }
                    },
                    onSelect = { onSettingsChange(settings.copy(source = it)) },
                    modifier = Modifier.fillMaxWidth(),
                )

                LabeledDropdown(
                    label = "Resolução",
                    options = Resolution.ALL,
                    selected = settings.resolution,
                    optionLabel = { it.label },
                    onSelect = { onSettingsChange(settings.copy(resolution = it)) },
                    modifier = Modifier.fillMaxWidth(),
                )

                LabeledDropdown(
                    label = "Quadros por segundo",
                    options = FPS_OPTIONS,
                    selected = settings.fps,
                    optionLabel = { "$it FPS" },
                    onSelect = { onSettingsChange(settings.copy(fps = it)) },
                    modifier = Modifier.fillMaxWidth(),
                )

                LabeledDropdown(
                    label = "Bitrate máximo",
                    options = BITRATE_OPTIONS,
                    selected = BITRATE_OPTIONS.find { it.value == settings.bitrate } ?: BITRATE_OPTIONS.first(),
                    optionLabel = { it.label },
                    onSelect = { onSettingsChange(settings.copy(bitrate = it.value)) },
                    modifier = Modifier.fillMaxWidth(),
                )

                if (settings.source != CaptureSource.CAMERA) {
                    SwitchRow(
                        label = "Áudio da tela",
                        checked = settings.screenAudio,
                        onCheckedChange = { onSettingsChange(settings.copy(screenAudio = it)) },
                    )
                }
                if (settings.source != CaptureSource.SCREEN) {
                    SwitchRow(
                        label = "Microfone",
                        checked = settings.microphone,
                        onCheckedChange = { onSettingsChange(settings.copy(microphone = it)) },
                    )
                }
                if (settings.source != CaptureSource.SCREEN) {
                    LabeledDropdown(
                        label = "Câmera",
                        options = listOf(CameraFacing.USER, CameraFacing.ENVIRONMENT),
                        selected = settings.cameraFacing,
                        optionLabel = { if (it == CameraFacing.USER) "Frontal" else "Traseira" },
                        onSelect = { onSettingsChange(settings.copy(cameraFacing = it)) },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        }

        Button(onClick = onStartBroadcast, modifier = Modifier.fillMaxWidth().height(52.dp)) {
            Text("Iniciar transmissão")
        }

        Divider()

        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            SectionLabel("assistir uma transmissão")
            Text("Já tem um link ou código de um amigo?", style = MaterialTheme.typography.titleMedium)
            OutlinedTextField(
                value = watchInput,
                onValueChange = { watchInput = it },
                label = { Text("Link ou código da transmissão") },
                placeholder = { Text("https://... ou o código") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedButton(
                onClick = { if (watchInput.isNotBlank()) onWatch(watchInput.trim()) },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Entrar na transmissão")
            }
        }

        Text(
            "sem upload · sem login · feito para poucos amigos",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.fillMaxWidth(),
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
    }
}

@Composable
private fun SwitchRow(label: String, checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label)
        Switch(checked = checked, onCheckedChange = onCheckedChange)
    }
}
