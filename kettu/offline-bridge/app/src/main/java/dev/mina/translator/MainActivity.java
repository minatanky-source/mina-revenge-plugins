// SPDX-License-Identifier: GPL-3.0-only
package dev.mina.translator;

import android.app.Activity;
import android.os.Bundle;
import android.os.Build;
import android.content.Intent;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.widget.*;
import com.google.mlkit.common.model.RemoteModelManager;
import com.google.mlkit.common.model.DownloadConditions;
import com.google.mlkit.nl.translate.TranslateLanguage;
import com.google.mlkit.nl.translate.TranslateRemoteModel;
import java.security.SecureRandom;
import java.util.*;

public class MainActivity extends Activity {
    private TextView status;
    private LinearLayout layout;
    private Button download;
    static String token(Context context) {
        android.content.SharedPreferences prefs = context.getSharedPreferences("connection", MODE_PRIVATE);
        String existing = prefs.getString("token", null);
        if (existing != null) return existing;
        byte[] bytes = new byte[32]; new SecureRandom().nextBytes(bytes);
        StringBuilder value = new StringBuilder();
        for (byte b : bytes) value.append(String.format(Locale.ROOT, "%02x", b & 255));
        existing = value.toString(); prefs.edit().putString("token", existing).apply(); return existing;
    }
    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        token(this);
        ScrollView scroll = new ScrollView(this);
        layout = new LinearLayout(this); layout.setOrientation(LinearLayout.VERTICAL);
        int pad = (int)(20 * getResources().getDisplayMetrics().density);
        layout.setPadding(pad, pad * 2, pad, pad); layout.setBackgroundColor(Color.rgb(23,24,29));
        scroll.addView(layout); setContentView(scroll);
        text("Mina Offline", 26);
        text("Tradução no seu celular · versão de teste", 15);
        text("1. Baixe os idiomas uma vez, por Wi-Fi.\n2. Inicie o tradutor.\n3. Copie o código e cole nas configurações do plugin Kettu.", 17);
        text("Idiomas: pt = português, en = inglês, es = espanhol. Separe por vírgula.", 14);
        EditText languages = new EditText(this); languages.setSingleLine(true); languages.setText("pt,en"); languages.setTextColor(Color.WHITE); layout.addView(languages);
        download = button("Baixar idiomas por Wi-Fi", () -> downloadLanguages(languages.getText().toString()));
        button("Iniciar tradutor", () -> {
            if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
                requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 1);
            startForegroundService(new Intent(this, TranslationService.class));
            status.setText("Iniciando… Use Testar Offline nas configurações do plugin para verificar a conexão.");
        });
        button("Copiar código de conexão", () -> {
            ClipboardManager cb = (ClipboardManager)getSystemService(CLIPBOARD_SERVICE);
            ClipData clip = ClipData.newPlainText("Mina Offline", token(this));
            if (Build.VERSION.SDK_INT >= 33) {
                android.os.PersistableBundle extras = new android.os.PersistableBundle();
                extras.putBoolean("android.content.extra.IS_SENSITIVE", true); clip.getDescription().setExtras(extras);
            }
            cb.setPrimaryClip(clip); status.setText("Código copiado. Cole no campo Mina Offline do plugin, não em uma mensagem.");
        });
        button("Parar tradutor", () -> { stopService(new Intent(this, TranslationService.class)); status.setText("Tradutor parado."); });
        status = text("Baixe os idiomas para começar.", 16);
        text("O texto é traduzido no aparelho. O serviço só escuta em 127.0.0.1 e exige o código de conexão. Nenhum texto de conversa é salvo pelo app.\n\nO Android pode interromper apps em segundo plano: se parar, abra este app e toque em Iniciar novamente.\n\nGírias e abreviações podem ser interpretadas incorretamente. O Discord continua precisando de internet para enviar e receber mensagens.", 14);
        text("Powered by Google Translate", 14);
        button("Atribuição e termos do Google", () -> startActivity(new Intent(Intent.ACTION_VIEW, android.net.Uri.parse("https://developers.google.com/ml-kit/language/translation/translation-terms"))));
    }
    private TextView text(String value, int size) {
        TextView view = new TextView(this); view.setText(value); view.setTextSize(size); view.setTextColor(Color.WHITE); view.setPadding(0, 8, 0, 16); layout.addView(view); return view;
    }
    private Button button(String value, Runnable action) {
        Button view = new Button(this); view.setText(value); view.setAllCaps(false); view.setOnClickListener(v -> action.run()); layout.addView(view); return view;
    }
    private void downloadLanguages(String value) {
        Set<String> languages = new LinkedHashSet<>();
        for (String raw : value.split(",")) {
            String language = TranslateLanguage.fromLanguageTag(raw.trim());
            if (language == null) { status.setText("Idioma inválido: " + raw); return; }
            if (!language.equals("en")) languages.add(language);
        }
        if (languages.isEmpty()) { status.setText("Inclua o idioma de tradução, por exemplo pt,en."); return; }
        download.setEnabled(false); status.setText("Baixando por Wi-Fi… Mantenha este app aberto. Cada idioma ocupa aproximadamente 30 MB.");
        RemoteModelManager manager = RemoteModelManager.getInstance();
        List<com.google.android.gms.tasks.Task<Void>> tasks = new ArrayList<>();
        for (String language : languages) tasks.add(manager.download(new TranslateRemoteModel.Builder(language).build(), new DownloadConditions.Builder().requireWifi().build()));
        com.google.android.gms.tasks.Tasks.whenAll(tasks)
            .addOnSuccessListener(this, unused -> { download.setEnabled(true); status.setText("Idiomas prontos. Agora toque em Iniciar tradutor."); })
            .addOnFailureListener(this, error -> { download.setEnabled(true); status.setText("Não foi possível baixar. Verifique o Wi-Fi e tente novamente."); });
    }
}
