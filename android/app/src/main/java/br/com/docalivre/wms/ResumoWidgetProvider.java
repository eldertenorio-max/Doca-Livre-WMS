package br.com.docalivre.wms;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.text.format.DateFormat;
import android.widget.RemoteViews;

import com.google.androidbrowserhelper.trusted.LauncherActivity;

import org.json.JSONObject;

import java.util.Date;

/**
 * Widget da tela inicial: paletes para guardar, tarefas de separacao e alertas. Mostra na hora o ultimo resumo
 * guardado e pede ao ResumoWorker para buscar o atual.
 */
public class ResumoWidgetProvider extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] widgetIds) {
        render(context, manager, widgetIds);
        ResumoWorker.refreshNow(context);
    }

    @Override
    public void onEnabled(Context context) {
        ResumoWorker.schedulePeriodic(context);
    }

    /** Redesenha todos os widgets com o resumo guardado. */
    static void renderAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, ResumoWidgetProvider.class));
        if (ids != null && ids.length > 0) render(context, manager, ids);
    }

    private static String numero(JSONObject json, String chave) {
        return json == null || json.isNull(chave) ? "—" : String.valueOf(json.optInt(chave, 0));
    }

    private static void render(Context context, AppWidgetManager manager, int[] widgetIds) {
        JSONObject json = null;
        String guardado = Prefs.resumo(context);
        if (guardado != null) {
            try {
                json = new JSONObject(guardado);
            } catch (Exception ignored) {
                json = null;
            }
        }
        long at = Prefs.resumoAt(context);
        String erro = Prefs.erro(context);

        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse(Prefs.SITE + "/coletor/"));
        open.setClass(context, LauncherActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent tap = PendingIntent.getActivity(
                context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        for (int id : widgetIds) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_resumo);
            views.setTextViewText(R.id.widget_guardar, numero(json, "aguardando_guarda"));
            views.setTextViewText(R.id.widget_separar, numero(json, "separacao"));
            views.setTextViewText(R.id.widget_alertas, numero(json, "alertas"));
            if (erro != null) {
                views.setTextViewText(R.id.widget_updated, erro);
            } else if (json != null) {
                views.setTextViewText(R.id.widget_updated,
                        "atualizado às " + DateFormat.getTimeFormat(context).format(new Date(at)));
            } else if (Prefs.endpoint(context) != null) {
                views.setTextViewText(R.id.widget_updated, "Buscando as pendências…");
            }
            views.setOnClickPendingIntent(R.id.widget_root, tap);
            manager.updateAppWidget(id, views);
        }
    }
}
