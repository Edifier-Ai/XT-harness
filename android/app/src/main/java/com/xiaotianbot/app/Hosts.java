package com.xiaotianbot.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** The computers this phone paired with: where each one is on the network, the token it gave, its name. */
final class Hosts {
    static final class Host {
        String id, origin, token, name;
        long at;
    }

    private final SharedPreferences prefs;

    Hosts(Context c) {
        prefs = c.getSharedPreferences("hosts", Context.MODE_PRIVATE);
    }

    /** scheme://host:port of a link, or null when it is not http(s) */
    static String originOf(String url) {
        if (url == null) return null;
        Uri u = Uri.parse(url);
        String s = u.getScheme();
        if (!"http".equals(s) && !"https".equals(s) || u.getHost() == null) return null;
        int port = u.getPort();
        return s + "://" + u.getHost() + (port > 0 ? ":" + port : "");
    }

    synchronized List<Host> all() {
        List<Host> out = new ArrayList<>();
        try {
            JSONArray a = new JSONArray(prefs.getString("list", "[]"));
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.getJSONObject(i);
                Host h = new Host();
                h.id = o.getString("id");
                h.origin = o.getString("origin");
                h.token = o.optString("token");
                h.name = o.optString("name");
                h.at = o.optLong("at");
                out.add(h);
            }
        } catch (JSONException ignored) {
        }
        return out;
    }

    private void write(List<Host> list) {
        JSONArray a = new JSONArray();
        try {
            for (Host h : list) a.put(new JSONObject().put("id", h.id).put("origin", h.origin).put("token", h.token).put("name", h.name).put("at", h.at));
        } catch (JSONException ignored) {
        }
        prefs.edit().putString("list", a.toString()).apply();
    }

    synchronized Host current() {
        String id = prefs.getString("current", "");
        for (Host h : all()) if (h.id.equals(id)) return h;
        return null;
    }

    synchronized boolean has(String origin) {
        if (origin == null) return false;
        for (Host h : all()) if (h.origin.equals(origin)) return true;
        return false;
    }

    /** remembers (or refreshes) a computer and makes it the one the App opens; true when anything changed */
    synchronized boolean save(String origin, String token, String name) {
        List<Host> list = all();
        Host found = null;
        for (Host h : list) if (h.origin.equals(origin)) found = h;
        boolean changed = found == null || !token.equals(found.token) || !name.equals(found.name) || !found.id.equals(prefs.getString("current", ""));
        if (found == null) {
            found = new Host();
            found.id = Long.toString(System.currentTimeMillis(), 36);
            found.origin = origin;
            list.add(found);
        }
        found.token = token;
        found.name = name;
        if (changed) found.at = System.currentTimeMillis();
        if (changed) {
            write(list);
            prefs.edit().putString("current", found.id).apply();
        }
        return changed;
    }

    synchronized Host pick(String id) {
        for (Host h : all())
            if (h.id.equals(id)) {
                prefs.edit().putString("current", id).apply();
                return h;
            }
        return null;
    }

    synchronized void forget(String id) {
        List<Host> list = all();
        list.removeIf(h -> h.id.equals(id));
        write(list);
        if (id.equals(prefs.getString("current", ""))) prefs.edit().remove("current").apply();
    }

    /** for the pages: no tokens */
    synchronized String json() {
        JSONArray a = new JSONArray();
        String cur = prefs.getString("current", "");
        try {
            for (Host h : all()) a.put(new JSONObject().put("id", h.id).put("name", h.name).put("origin", h.origin).put("current", h.id.equals(cur)).put("at", h.at));
        } catch (JSONException ignored) {
        }
        return a.toString();
    }
}
