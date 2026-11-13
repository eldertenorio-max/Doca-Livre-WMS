package br.com.docalivre.wms;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import com.google.androidbrowserhelper.trusted.LauncherActivity;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.TimeUnit;

/**
 * Busca as pendencias do armazem em /api/app/resumo (link pessoal do usuario), atualiza o widget e avisa quando
 * aparecem alertas graves novos. Roda a cada 30 min e ao abrir a tela "App do WMS".
 */
public class ResumoWorker extends Worker {
    private static final String PERIODIC = "resumo-periodic";
    private static final String NOW = "resumo-now";
    private static final String CANAL = "alertas";

    public ResumoWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();
        String endpoint = Prefs.endpoint(context);
        if (endpoint == null) return Result.success();

        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(endpoint).openConnection();
            connection.setConnectTimeout(20_000);
            connection.setReadTimeout(60_000);
            connection.setRequestProperty("X-App-Versao", versao(context));
            connection.setRequestProperty("Accept", "application/json");
            int code = connection.getResponseCode();
            if (code == 401 || code == 403) {
                Prefs.setErro(context, "O WMS recusou este celular. Ative de novo em Aplicativo, dentro do WMS.");
                ResumoWidgetProvider.renderAll(context);
                return Result.success();
            }
            if (code != 200) return code >= 500 ? Result.retry() : Result.success();
            String corpo = readAll(connection.getInputStream());
            JSONObject json = new JSONObject(corpo);
            Prefs.saveResumo(context, corpo);
            ResumoWidgetProvider.renderAll(context);
            avisar(context, json);
            return Result.success();
        } catch (Exception e) {
            return getRunAttemptCount() < 3 ? Result.retry() : Result.failure();
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    /** Notificacao quando o numero de alertas graves aumenta. */
    private static void avisar(Context context, JSONObject json) {
        int graves = json.optInt("alertas_graves", 0);
        int antes = Prefs.avisados(context);
        Prefs.setAvisados(context, graves);
        if (graves <= antes) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        if (Build.VERSION.SDK_INT >= 33
                && context.checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                    new NotificationChannel(CANAL, "Alertas do armazém", NotificationManager.IMPORTANCE_DEFAULT));
        }
        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse(Prefs.SITE + "/alertas"));
        open.setClass(context, LauncherActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent tap = PendingIntent.getActivity(
                context, 1, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(context, CANAL)
                : new Notification.Builder(context);
        String texto = json.optString("alerta_texto", "");
        builder.setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(graves == 1 ? "1 alerta grave no armazém" : graves + " alertas graves no armazém")
                .setContentText(texto.isEmpty() ? "Toque para ver no WMS." : texto)
                .setContentIntent(tap)
                .setAutoCancel(true);
        manager.notify(1, builder.build());
    }

    static String versao(Context context) {
        try {
            return context.getPackageManager().getPackageInfo(context.getPackageName(), 0).versionName;
        } catch (PackageManager.NameNotFoundException e) {
            return "?";
        }
    }

    private static Constraints online() {
        return new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
    }

    /** Atualiza ja. */
    static void refreshNow(Context context) {
        Context app = context.getApplicationContext();
        if (Prefs.endpoint(app) == null) return;
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(ResumoWorker.class)
                .setConstraints(online())
                .build();
        WorkManager.getInstance(app).enqueueUniqueWork(NOW, ExistingWorkPolicy.REPLACE, request);
    }

    static void schedulePeriodic(Context context) {
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(ResumoWorker.class, 30, TimeUnit.MINUTES)
                .setConstraints(online())
                .build();
        WorkManager.getInstance(context.getApplicationContext())
                .enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, request);
    }

    static void cancelPeriodic(Context context) {
        WorkManager.getInstance(context.getApplicationContext()).cancelUniqueWork(PERIODIC);
    }

    private static String readAll(InputStream in) throws java.io.IOException {
        try (InputStream stream = in; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int read;
            while ((read = stream.read(buffer)) != -1) out.write(buffer, 0, read);
            return out.toString("UTF-8");
        }
    }
}
