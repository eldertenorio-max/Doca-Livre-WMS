package br.com.docalivre.wms;

import android.content.Context;
import android.content.SharedPreferences;

/** Configuracao e ultimo resumo, guardados so no celular. */
final class Prefs {
    private Prefs() {}

    static final String SITE = "https://wms.docalivre.com.br";
    private static final String NAME = "doca_livre_wms";

    private static SharedPreferences sp(Context context) {
        return context.getApplicationContext().getSharedPreferences(NAME, Context.MODE_PRIVATE);
    }

    /** Link pessoal (.../api/app/resumo?token=...), vindo do botao "Ativar neste celular" do WMS. */
    static String endpoint(Context context) {
        return sp(context).getString("endpoint", null);
    }

    static void setEndpoint(Context context, String url) {
        sp(context).edit().putString("endpoint", url).apply();
    }

    static void clearEndpoint(Context context) {
        sp(context).edit().remove("endpoint").remove("resumo").remove("resumo_at").apply();
    }

    static void saveResumo(Context context, String json) {
        sp(context).edit().putString("resumo", json).putLong("resumo_at", System.currentTimeMillis()).remove("erro").apply();
    }

    static String resumo(Context context) {
        return sp(context).getString("resumo", null);
    }

    static long resumoAt(Context context) {
        return sp(context).getLong("resumo_at", 0);
    }

    static void setErro(Context context, String erro) {
        sp(context).edit().putString("erro", erro).apply();
    }

    static String erro(Context context) {
        return sp(context).getString("erro", null);
    }

    /** Quantos alertas graves ja foram avisados (para nao repetir a mesma notificacao). */
    static int avisados(Context context) {
        return sp(context).getInt("avisados", 0);
    }

    static void setAvisados(Context context, int total) {
        sp(context).edit().putInt("avisados", total).apply();
    }
}
