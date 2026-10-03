package com.p2pcast.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.p2pcast.android.AppError
import com.p2pcast.android.StreamMode

@Composable
fun StatusPill(mode: StreamMode, modifier: Modifier = Modifier) {
    val isLive = mode == StreamMode.BROADCASTING || mode == StreamMode.WATCHING
    val label = when (mode) {
        StreamMode.IDLE -> "Pronto para começar"
        StreamMode.STARTING -> "Preparando transmissão"
        StreamMode.BROADCASTING -> "Transmissão ativa"
        StreamMode.CONNECTING -> "Conectando à transmissão"
        StreamMode.WATCHING -> "Assistindo ao vivo"
        StreamMode.ERROR -> "A conexão precisa de atenção"
    }

    Row(
        modifier = modifier
            .background(
                if (isLive) MaterialTheme.colorScheme.secondary.copy(alpha = 0.15f)
                else MaterialTheme.colorScheme.surfaceVariant,
                RoundedCornerShape(50),
            )
            .padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Spacer(
            Modifier
                .size(8.dp)
                .background(
                    if (isLive) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.onSurfaceVariant,
                    CircleShape,
                ),
        )
        Text(label, style = MaterialTheme.typography.labelLarge)
    }
}

@Composable
fun ErrorCard(
    error: AppError,
    onRetry: (() -> Unit)?,
    onHome: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
    ) {
        Column(Modifier.padding(16.dp)) {
            Text(error.title, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onErrorContainer)
            Spacer(Modifier.height(4.dp))
            Text(error.message, color = MaterialTheme.colorScheme.onErrorContainer)
            error.details?.let {
                Spacer(Modifier.height(4.dp))
                Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onErrorContainer)
            }
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (onRetry != null) {
                    Button(onClick = onRetry) { Text("Tentar novamente") }
                }
                OutlinedButton(onClick = onHome) { Text("Voltar ao início") }
            }
        }
    }
}

val BrandGradientStart = Color(0xFF6D5EF8)
val BrandGradientEnd = Color(0xFF22D3B8)
