// SPDX-License-Identifier: GPL-3.0-only
package dev.mina.translator;

import android.app.*;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.*;
import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.common.model.RemoteModelManager;
import com.google.mlkit.nl.translate.*;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.TimeUnit;

public class TranslationService extends Service {
    private volatile ServerSocket server;
    private volatile Socket current;
    private volatile boolean stopped;
    private Thread worker;
    private final LinkedHashMap<String, Translator> translators = new LinkedHashMap<>();
    @Override public void onCreate() {
        super.onCreate();
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel("translator", "Tradutor offline", NotificationManager.IMPORTANCE_LOW));
        PendingIntent stop = PendingIntent.getService(this, 0, new Intent(this, TranslationService.class).setAction("STOP"), PendingIntent.FLAG_IMMUTABLE);
        PendingIntent open = PendingIntent.getActivity(this, 1, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new Notification.Builder(this, "translator").setContentTitle("Mina Offline ativo")
            .setContentText("Tradução local para o Kettu · toque para abrir")
            .setSmallIcon(android.R.drawable.ic_menu_manage).setContentIntent(open).setOngoing(true)
            .addAction(new Notification.Action.Builder(null, "Parar", stop).build()).build();
        if (Build.VERSION.SDK_INT >= 34) startForeground(1, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(1, notification);
        worker = new Thread(this::serve, "MinaTranslation"); worker.start();
    }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && "STOP".equals(intent.getAction())) stopSelf();
        return START_NOT_STICKY;
    }
    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public void onDestroy() {
        stopped = true;
        try { if (server != null) server.close(); } catch (IOException ignored) {}
        try { if (current != null) current.close(); } catch (IOException ignored) {}
        if (worker != null) worker.interrupt();
        stopForeground(STOP_FOREGROUND_REMOVE); super.onDestroy();
    }
    private void serve() {
        try (ServerSocket listener = new ServerSocket()) {
            server = listener;
            listener.setReuseAddress(true);
            listener.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), 17843), 4);
            while (!stopped) {
                try (Socket socket = listener.accept()) {
                    current = socket; socket.setSoTimeout(5000);
                    try { handle(socket); } catch (Exception error) { try { respond(socket, 400, new JSONObject().put("error", "invalid_request")); } catch (Exception ignored) {} }
                    finally { current = null; }
                } catch (IOException error) { if (!stopped) continue; }
            }
        } catch (IOException error) {
            if (!stopped) new Handler(Looper.getMainLooper()).post(() -> android.widget.Toast.makeText(this, "Não foi possível iniciar a conexão local. Feche outro tradutor e tente novamente.", android.widget.Toast.LENGTH_LONG).show());
        } finally { for (Translator translator : translators.values()) translator.close(); translators.clear(); stopSelf(); }
    }
    private String line(InputStream input) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        for (int i = 0; i < 4096; i++) {
            int c = input.read(); if (c < 0) throw new EOFException();
            if (c == '\n') return bytes.toString("US-ASCII").replace("\r", "");
            bytes.write(c);
        }
        throw new IOException("header_too_long");
    }
    private void handle(Socket socket) throws Exception {
        InputStream input = new BufferedInputStream(socket.getInputStream());
        String[] request = line(input).split(" ");
        Map<String,String> headers = new HashMap<>();
        int headerSize = 0;
        while (true) {
            String header = line(input); headerSize += header.length();
            if (headerSize > 16384) throw new IOException("headers_too_long");
            if (header.isEmpty()) break;
            int colon = header.indexOf(':'); if (colon < 1) throw new IOException("bad_header");
            String key = header.substring(0,colon).trim().toLowerCase(Locale.ROOT);
            if (headers.put(key, header.substring(colon+1).trim()) != null) throw new IOException("duplicate_header");
        }
        // Browsers have no CORS access, and the bridge never binds to Wi-Fi/LAN.
        String wanted = "Bearer " + MainActivity.token(this);
        if (headers.containsKey("origin") || !MessageDigest.isEqual(wanted.getBytes(StandardCharsets.UTF_8), headers.getOrDefault("authorization", "").getBytes(StandardCharsets.UTF_8))) {
            respond(socket, 401, new JSONObject().put("error", "unauthorized")); return;
        }
        if (request.length != 3 || !request[0].equals("POST") || !request[1].equals("/translate") || headers.containsKey("transfer-encoding")) {
            respond(socket, 400, new JSONObject().put("error", "invalid_request")); return;
        }
        int length = Integer.parseInt(headers.getOrDefault("content-length", "0"));
        if (length < 1 || length > 65536) { respond(socket, 413, new JSONObject().put("error", "body_too_large")); return; }
        byte[] body = new byte[length]; int read = 0;
        while (read < length) { int n = input.read(body, read, length-read); if (n < 0) throw new EOFException(); read += n; }
        JSONObject data = new JSONObject(new String(body, StandardCharsets.UTF_8));
        String source = TranslateLanguage.fromLanguageTag(data.getString("source")), target = TranslateLanguage.fromLanguageTag(data.getString("target"));
        if (source == null || target == null) throw new IOException("invalid_language");
        JSONArray texts = data.getJSONArray("texts");
        if (texts.length() < 1 || texts.length() > 6) throw new IOException("invalid_batch");
        for (int i = 0; i < texts.length(); i++) if (!(texts.get(i) instanceof String) || texts.getString(i).length() > 8000) throw new IOException("invalid_text");
        Set<TranslateRemoteModel> downloaded = Tasks.await(RemoteModelManager.getInstance().getDownloadedModels(TranslateRemoteModel.class), 10, TimeUnit.SECONDS);
        Set<String> available = new HashSet<>(); available.add("en");
        for (TranslateRemoteModel model : downloaded) available.add(model.getLanguage());
        if (!source.equals(target) && (!available.contains(source) || !available.contains(target))) {
            respond(socket, 409, new JSONObject().put("error", "models_missing")); return;
        }
        JSONArray result = new JSONArray();
        if (source.equals(target)) for (int i = 0; i < texts.length(); i++) result.put(texts.getString(i));
        else {
            String pair = source + ":" + target;
            Translator translator = translators.get(pair);
            if (translator == null) {
                if (translators.size() >= 2) { String first = translators.keySet().iterator().next(); translators.remove(first).close(); }
                translator = Translation.getClient(new TranslatorOptions.Builder().setSourceLanguage(source).setTargetLanguage(target).build());
                translators.put(pair, translator);
            }
            try { for (int i = 0; i < texts.length(); i++) result.put(translateProtected(translator, texts.getString(i))); }
            catch (Exception error) { respond(socket, 503, new JSONObject().put("error", "translation_failed")); return; }
        }
        respond(socket, 200, new JSONObject().put("translations", result));
    }
    private String translateProtected(Translator translator, String text) throws Exception {
        java.util.regex.Matcher tokens = java.util.regex.Pattern.compile("QZX(?:SAFE)*KEEP\\d+XZQ").matcher(text);
        StringBuilder output = new StringBuilder(); int start = 0;
        while (tokens.find()) {
            output.append(translateSegment(translator, text.substring(start, tokens.start())));
            output.append(tokens.group()); start = tokens.end();
        }
        output.append(translateSegment(translator, text.substring(start))); return output.toString();
    }
    private String translateSegment(Translator translator, String text) throws Exception {
        if (text.trim().isEmpty()) return text;
        int left = 0, right = text.length();
        while (left < right && Character.isWhitespace(text.charAt(left))) left++;
        while (right > left && Character.isWhitespace(text.charAt(right-1))) right--;
        return text.substring(0,left) + Tasks.await(translator.translate(text.substring(left,right)), 15, TimeUnit.SECONDS) + text.substring(right);
    }
    private void respond(Socket socket, int code, JSONObject body) throws IOException {
        byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
        OutputStream output = socket.getOutputStream();
        String headers = "HTTP/1.1 " + code + " " + (code == 200 ? "OK" : "Error") + "\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: " + bytes.length + "\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n";
        output.write(headers.getBytes(StandardCharsets.US_ASCII)); output.write(bytes); output.flush();
    }
}
