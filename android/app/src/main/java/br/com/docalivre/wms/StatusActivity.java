package br.com.docalivre.wms;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.format.DateFormat;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import com.google.androidbrowserhelper.trusted.LauncherActivity;

import org.json.JSONObject;

import java.util.Date;

/**
 * Tela "App do WMS": mostra se este celular esta ativado, o ultimo resumo do armazem e a permissao de notificacao.
 * Tambem recebe o link docalivrewms://setup?u=... do botao "Ativar neste celular" do WMS.
 */
public class StatusActivity extends Activity {
    private LinearLayout root;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(Color.parseColor("#101014"));
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int margem = dp(20);
        root.setPadding(margem, dp(28), margem, margem);
        scroll.addView(root, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        setContentView(scroll);
        handleSetup(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleSetup(intent);
        render();
    }

    @Override
    protected void onResume() {
        super.onResume();
        ResumoWorker.refreshNow(this);
        render();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        render();
    }

    /** docalivrewms://setup?u=<link pessoal>: so aceita link do proprio WMS. */
    private void handleSetup(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        if (data == null || !"docalivrewms".equals(data.getScheme())) return;
        String link = data.getQueryParameter("u");
        if (link != null && link.startsWith(Prefs.SITE + "/api/app/resumo?token=")) {
            Prefs.setEndpoint(this, link);
            Prefs.setAvisados(this, 0);
            ResumoWorker.schedulePeriodic(this);
            ResumoWorker.refreshNow(this);
            Toast.makeText(this, "Celular ativado no WMS.", Toast.LENGTH_LONG).show();
        } else {
            Toast.makeText(this, "Link de ativação inválido.", Toast.LENGTH_LONG).show();
        }
    }

    private boolean notificacoesPermitidas() {
        return Build.VERSION.SDK_INT < 33
                || checkSelfPermission("android.permission.POST_NOTIFICATIONS") == PackageManager.PERMISSION_GRANTED;
    }

    private void render() {
        root.removeAllViews();
        texto("Doca Livre WMS", 24, Color.WHITE, true);
        texto("Aplicativo versão " + ResumoWorker.versao(this), 13, Color.parseColor("#A1A1AA"), false);
        espaco(18);

        boolean ativado = Prefs.endpoint(this) != null;
        cartao(ativado ? "Este celular está ativado" : "Este celular ainda não está ativado",
                ativado ? "O widget e os avisos de alerta usam o seu usuário do WMS."
                        : "Abra o WMS, entre em Coletor › Aplicativo Android e toque em “Ativar neste celular”.",
                ativado);

        if (ativado) {
            String erro = Prefs.erro(this);
            JSONObject json = null;
            try {
                String guardado = Prefs.resumo(this);
                if (guardado != null) json = new JSONObject(guardado);
            } catch (Exception ignored) {
                json = null;
            }
            if (erro != null) {
                cartao("Não foi possível buscar o resumo", erro, false);
            } else if (json != null) {
                String quando = DateFormat.getTimeFormat(this).format(new Date(Prefs.resumoAt(this)));
                cartao("Armazém às " + quando,
                        "Paletes para guardar: " + json.optInt("aguardando_guarda", 0)
                                + "\nTarefas de separação: " + json.optInt("separacao", 0)
                                + "\nNotas de entrada em aberto: " + json.optInt("notas_abertas", 0)
                                + "\nAlertas: " + json.optInt("alertas", 0) + " (" + json.optInt("alertas_graves", 0) + " graves)"
                                + (json.optString("usuario", "").isEmpty() ? "" : "\nUsuário: " + json.optString("usuario")),
                        true);
            } else {
                cartao("Buscando o resumo do armazém…", "Isso leva alguns segundos na primeira vez.", true);
            }
        }

        cartao(notificacoesPermitidas() ? "Notificações permitidas" : "Notificações bloqueadas",
                notificacoesPermitidas() ? "Você é avisado quando surgem alertas graves (produto vencido, câmara fora da temperatura)."
                        : "Sem a permissão, o app não consegue avisar dos alertas.",
                notificacoesPermitidas());
        if (!notificacoesPermitidas()) {
            botao("Permitir notificações", v -> requestPermissions(new String[] {"android.permission.POST_NOTIFICATIONS"}, 7));
        }

        espaco(8);
        botao("Abrir o WMS", v -> abrir(Prefs.SITE + "/?apk=1"));
        botao("Abrir o Coletor", v -> abrir(Prefs.SITE + "/coletor/?apk=1"));
        if (ativado) {
            botao("Atualizar agora", v -> {
                ResumoWorker.refreshNow(this);
                Toast.makeText(this, "Atualizando…", Toast.LENGTH_SHORT).show();
                root.postDelayed(this::render, 4000);
            });
            botao("Desativar neste celular", v -> {
                Prefs.clearEndpoint(this);
                ResumoWorker.cancelPeriodic(this);
                ResumoWidgetProvider.renderAll(this);
                render();
            });
        }
    }

    private void abrir(String url) {
        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        open.setClass(this, LauncherActivity.class);
        startActivity(open);
    }

    private int dp(int valor) {
        return Math.round(valor * getResources().getDisplayMetrics().density);
    }

    private TextView texto(String conteudo, int tamanho, int cor, boolean negrito) {
        TextView view = new TextView(this);
        view.setText(conteudo);
        view.setTextSize(tamanho);
        view.setTextColor(cor);
        if (negrito) view.setTypeface(Typeface.DEFAULT_BOLD);
        root.addView(view);
        return view;
    }

    private void espaco(int altura) {
        View view = new View(this);
        root.addView(view, new LinearLayout.LayoutParams(1, dp(altura)));
    }

    private void cartao(String titulo, String detalhe, boolean ok) {
        LinearLayout caixa = new LinearLayout(this);
        caixa.setOrientation(LinearLayout.VERTICAL);
        caixa.setBackgroundColor(Color.parseColor("#1C1C21"));
        caixa.setPadding(dp(16), dp(14), dp(16), dp(14));
        TextView t = new TextView(this);
        t.setText(titulo);
        t.setTextSize(16);
        t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setTextColor(ok ? Color.parseColor("#4ADE80") : Color.parseColor("#FBBF24"));
        caixa.addView(t);
        TextView d = new TextView(this);
        d.setText(detalhe);
        d.setTextSize(14);
        d.setTextColor(Color.parseColor("#D4D4D8"));
        d.setPadding(0, dp(4), 0, 0);
        caixa.addView(d);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.setMargins(0, 0, 0, dp(10));
        root.addView(caixa, params);
    }

    private void botao(String rotulo, View.OnClickListener acao) {
        Button button = new Button(this);
        button.setText(rotulo);
        button.setAllCaps(false);
        button.setTextSize(16);
        button.setGravity(Gravity.CENTER);
        button.setOnClickListener(acao);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(52));
        params.setMargins(0, 0, 0, dp(8));
        root.addView(button, params);
    }
}
