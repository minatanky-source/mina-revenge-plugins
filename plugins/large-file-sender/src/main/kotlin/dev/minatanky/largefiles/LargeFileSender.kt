@file:JvmName("LargeFileSender")

package dev.minatanky.largefiles

import android.content.Context
import android.net.Uri
import io.github.revenge.plugins.plugin
import io.github.revenge.xposed.api.registerNativeAsyncMethod
import kotlinx.coroutines.CompletableDeferred
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.security.MessageDigest
import java.util.UUID

private const val MAX_PART_BYTES = 50L * 1024L * 1024L
private const val MIN_PART_BYTES = 1L * 1024L * 1024L
private const val SESSION_MAX_AGE_MS = 24L * 60L * 60L * 1000L

private data class TempPart(
    val file: File,
    val size: Long,
)

@Suppress("UNUSED")
val largeFileSender = plugin {
    start {
        val contextReady = CompletableDeferred<Context>()
        val chunksRoot = storageDir.resolve("chunks").apply { mkdirs() }

        withAppContext { context ->
            if (!contextReady.isCompleted) {
                contextReady.complete(context.applicationContext)
            }
        }

        fun cleanupOldSessions() {
            val cutoff = System.currentTimeMillis() - SESSION_MAX_AGE_MS
            chunksRoot.listFiles()
                ?.filter { it.isDirectory && it.lastModified() < cutoff }
                ?.forEach { runCatching { it.deleteRecursively() } }
        }

        fun safeFilename(input: String): String {
            val base = input
                .substringAfterLast('/')
                .substringAfterLast('\\')
                .replace(Regex("""[^\p{L}\p{N}._ ()\[\]-]"""), "_")
                .trim()
                .ifBlank { "arquivo.bin" }

            return if (base.length <= 150) base else base.take(150)
        }

        fun rawFileFromUri(uriText: String): File? {
            val uri = Uri.parse(uriText)
            return when (uri.scheme?.lowercase()) {
                "file" -> uri.path?.let(::File)
                null, "" -> File(uriText)
                else -> null
            }
        }

        fun knownSize(context: Context, uriText: String): Long? {
            rawFileFromUri(uriText)?.let { file ->
                return if (file.exists()) file.length() else null
            }

            val uri = Uri.parse(uriText)
            return runCatching {
                context.contentResolver.openAssetFileDescriptor(uri, "r")?.use { afd ->
                    afd.length.takeIf { it >= 0L }
                }
            }.getOrNull()
        }

        fun openInput(context: Context, uriText: String): InputStream {
            rawFileFromUri(uriText)?.let { file ->
                return file.inputStream()
            }

            val uri = Uri.parse(uriText)
            return requireNotNull(context.contentResolver.openInputStream(uri)) {
                "Não foi possível abrir o arquivo selecionado."
            }
        }

        fun cleanupSession(sessionId: String): Boolean {
            if (!sessionId.matches(Regex("""[A-Za-z0-9-]{10,80}"""))) return false

            val dir = chunksRoot.resolve(sessionId)
            val canonicalRoot = chunksRoot.canonicalFile
            val canonicalDir = dir.canonicalFile

            if (canonicalDir.parentFile != canonicalRoot) return false
            return !canonicalDir.exists() || canonicalDir.deleteRecursively()
        }

        cleanupOldSessions()

        registerNativeAsyncMethod("${manifest.id}.splitFile") { args ->
            val uriText = args.getOrNull(0) as? String
                ?: throw IllegalArgumentException("URI do arquivo ausente")
            val originalName = args.getOrNull(1) as? String ?: "arquivo.bin"
            val requestedPartSize = (args.getOrNull(2) as? Number)?.toLong()
                ?: throw IllegalArgumentException("Tamanho de parte ausente")
            val partSize = requestedPartSize.coerceIn(MIN_PART_BYTES, MAX_PART_BYTES)
            val context = contextReady.await()

            val sizeBefore = knownSize(context, uriText)
            if (sizeBefore != null && sizeBefore <= partSize) {
                return@registerNativeAsyncMethod mapOf(
                    "split" to false,
                    "size" to sizeBefore,
                )
            }

            val sessionId = UUID.randomUUID().toString()
            val sessionDir = chunksRoot.resolve(sessionId).apply { mkdirs() }
            val safeName = safeFilename(originalName)
            val tempParts = mutableListOf<TempPart>()
            val digest = MessageDigest.getInstance("SHA-256")
            var total = 0L

            try {
                openInput(context, uriText).use { input ->
                    val buffer = ByteArray(128 * 1024)
                    var output: FileOutputStream? = null
                    var outputFile: File? = null
                    var currentSize = 0L
                    var tempIndex = 0

                    fun openPart() {
                        tempIndex += 1
                        outputFile = sessionDir.resolve("part-$tempIndex.tmp")
                        output = FileOutputStream(outputFile!!)
                        currentSize = 0L
                    }

                    fun closePart() {
                        val stream = output ?: return
                        stream.flush()
                        stream.close()
                        val file = outputFile ?: return
                        tempParts += TempPart(file, currentSize)
                        output = null
                        outputFile = null
                        currentSize = 0L
                    }

                    try {
                        while (true) {
                            val read = input.read(buffer)
                            if (read < 0) break
                            if (read == 0) continue

                            digest.update(buffer, 0, read)
                            total += read.toLong()

                            var offset = 0
                            while (offset < read) {
                                if (output == null) openPart()

                                val room = partSize - currentSize
                                val count = minOf(room.toInt(), read - offset)
                                output!!.write(buffer, offset, count)
                                offset += count
                                currentSize += count.toLong()

                                if (currentSize >= partSize) closePart()
                            }
                        }

                        closePart()
                    } finally {
                        runCatching { output?.close() }
                    }
                }

                if (tempParts.size <= 1) {
                    sessionDir.deleteRecursively()
                    return@registerNativeAsyncMethod mapOf(
                        "split" to false,
                        "size" to total,
                    )
                }

                val count = tempParts.size
                val width = maxOf(3, count.toString().length)
                val parts = tempParts.mapIndexed { index, temp ->
                    val number = (index + 1).toString().padStart(width, '0')
                    val totalText = count.toString().padStart(width, '0')
                    val finalName = "$safeName.mina.part$number-of$totalText"
                    val target = sessionDir.resolve(finalName)

                    if (!temp.file.renameTo(target)) {
                        temp.file.copyTo(target, overwrite = true)
                        temp.file.delete()
                    }

                    mapOf(
                        "uri" to Uri.fromFile(target).toString(),
                        "filename" to finalName,
                        "size" to temp.size,
                        "index" to (index + 1),
                        "count" to count,
                    )
                }

                val sha256 = digest.digest().joinToString("") { byte ->
                    "%02x".format(byte)
                }

                mapOf(
                    "split" to true,
                    "size" to total,
                    "sessionId" to sessionId,
                    "sha256" to sha256,
                    "parts" to parts,
                )
            } catch (error: Throwable) {
                runCatching { sessionDir.deleteRecursively() }
                throw error
            }
        }

        registerNativeAsyncMethod("${manifest.id}.cleanupSession") { args ->
            val sessionId = args.getOrNull(0) as? String
                ?: return@registerNativeAsyncMethod false
            cleanupSession(sessionId)
        }

        log.i("Large File Sender native splitter ready")
    }

    stop {
        log.i("Unloaded ${manifest.id}")
    }
}
