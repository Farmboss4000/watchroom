/* ============================================================
   SITE NAV — single source of truth for cross-site navigation.
   Loaded (deferred) by every page after apple-skin.css.

   Rebuilds the .site-switcher bar and .login-site-links on every
   page from ONE canonical list, so order and contents are always
   identical site-wide. Daily-driver sections stay visible; the
   rest tuck into a "More" dropdown.

   Also tags the shared AI settings card (any page with
   #api-key-input) with a note that the setting is sitewide.

   Progressive enhancement: if this script fails to load, each
   page's original static nav remains.
   ============================================================ */
(function () {
    'use strict';

    var PRIMARY = [
        ['index.html',      '🏠', 'HQ'],
        ['machinery.html',  '🚜', 'Machinery'],
        ['armory.html',     '🔫', 'Armory'],
        ['automotive.html', '🚗', 'Automotive'],
        ['livestock.html',  '🐄', 'Livestock'],
        ['realestate.html', '🏡', 'Real Estate']
    ];
    var MORE = [
        ['timepieces.html',     '⌚', 'Timepieces'],
        ['knives.html',         '🔪', 'Knives'],
        ['globetrotting.html',  '✈️', 'Globetrotting'],
        ['vendors.html',        '💼', 'Vendors'],
        ['contacts.html',       '👥', 'Contacts'],
        ['estateplanning.html', '📜', 'Estate Planning'],
        ['pharmacy.html',       '💊', 'Pharmacy'],
        ['insurance.html',      '🛡', 'Insurance'],
        ['agents.html',         '🤖', 'Agents'],
        ['family.html',         '👨‍👩‍👧', 'Family'],
        ['teaparty.html',       '🫖', 'Tea Party'],
        ['dontpush.html',       '🚫', "Don't Push"],
        ['admin.html',          '🔧', 'Admin']
    ];

    var here = location.pathname.split('/').pop() || 'index.html';

    function linkHtml(item, cls) {
        var active = item[0] === here ? ' active' : '';
        return '<a href="' + item[0] + '" class="' + cls + active + '">' + item[1] + ' ' + item[2] + '</a>';
    }

    // ── Top switcher: primary links + "More" dropdown ──
    var bar = document.querySelector('.site-switcher');
    if (bar) {
        var moreActive = MORE.some(function (m) { return m[0] === here; });
        bar.innerHTML =
            PRIMARY.map(function (i) { return linkHtml(i, 'site-link'); }).join('') +
            '<details class="site-more">' +
              '<summary class="site-link' + (moreActive ? ' active' : '') + '">⋯ More</summary>' +
              '<div class="site-more-menu">' +
                MORE.map(function (i) { return linkHtml(i, 'site-link'); }).join('') +
              '</div>' +
            '</details>';

        // Close the dropdown when clicking anywhere else.
        document.addEventListener('click', function (e) {
            var open = bar.querySelector('details.site-more[open]');
            if (open && !open.contains(e.target)) open.removeAttribute('open');
        });
    }

    // ── Login-screen quick links: primary set only, consistent everywhere ──
    var loginLinks = document.querySelector('.login-site-links');
    if (loginLinks) {
        loginLinks.innerHTML = PRIMARY.map(function (i) { return linkHtml(i, ''); }).join('');
    }

    // ── Shared-settings note on any page exposing the AI key ──
    var keyInput = document.getElementById('api-key-input');
    if (keyInput && !document.querySelector('.shared-settings-note')) {
        var note = document.createElement('p');
        note.className = 'shared-settings-note';
        note.innerHTML = '🔗 <strong>Shared setting:</strong> this API key (and proxy/model) is one sitewide record used by every Farmboss app — change it once, it applies everywhere.';
        var anchor = keyInput.closest('.api-key-row') || keyInput.closest('.form-group') || keyInput.parentElement;
        if (anchor && anchor.parentElement) anchor.parentElement.insertBefore(note, anchor);
    }

    // ── Page access gate ──────────────────────────────────────
    // Owners reach every page. Guest accounts (created in a page's
    // "Shared Access" settings card) only reach pages whose allowlist in
    // settings/access includes their email; everywhere else they get a
    // full-screen "not shared with you" notice instead of the app.
    var OWNER_EMAILS = ['jeff@stoebner.com', 'jeffmstoebner@gmail.com'];

    function accessOverlay(email, page) {
        var el = document.getElementById('fb-access-denied');
        if (el) return el;
        el = document.createElement('div');
        el.id = 'fb-access-denied';
        el.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#f5f5f7;display:flex;align-items:center;justify-content:center;padding:24px;';
        el.innerHTML =
            '<div style="background:#fff;border:1px solid rgba(0,0,0,0.08);border-radius:16px;box-shadow:0 20px 48px rgba(16,20,28,0.10);padding:36px;max-width:430px;text-align:center;">' +
              '<div style="font-size:2.2rem;margin-bottom:10px;">🔒</div>' +
              '<div style="font-size:1.05rem;font-weight:700;color:#1d1d1f;margin-bottom:8px;">This page isn\u2019t shared with you</div>' +
              '<div style="font-size:0.88rem;color:#6e6e73;line-height:1.5;margin-bottom:18px;">The account <strong>' + email.replace(/[<>&"]/g, '') + '</strong> doesn\u2019t have access to <strong>' + page.replace(/[<>&"]/g, '') + '</strong>. Open the page that was shared with you, or ask the owner to grant access.</div>' +
              '<button id="fb-access-signout" style="background:#0071e3;color:#fff;border:none;border-radius:980px;padding:9px 22px;font-size:0.9rem;font-weight:600;cursor:pointer;">Sign out</button>' +
            '</div>';
        document.body.appendChild(el);
        var btn = el.querySelector('#fb-access-signout');
        btn.addEventListener('click', function () {
            try { window.firebase.auth().signOut(); } catch (e) {}
        });
        return el;
    }

    function initAccessGate() {
        if (!window.firebase || !window.firebase.auth || !window.firebase.firestore) return;
        var page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
        var lc = function (s) { return String(s || '').toLowerCase(); };
        try {
            window.firebase.auth().onAuthStateChanged(function (user) {
                var el = document.getElementById('fb-access-denied');
                if (!user || !user.email) { if (el) el.remove(); return; }
                var email = lc(user.email);
                if (OWNER_EMAILS.indexOf(email) !== -1) { if (el) el.remove(); return; }
                window.firebase.firestore().collection('settings').doc('access').get().then(function (doc) {
                    var d = (doc && doc.exists) ? doc.data() : {};
                    var owners = (d.owners || []).map(lc);
                    var pageList = ((d.pages || {})[page] || []).map(lc);
                    var cur = document.getElementById('fb-access-denied');
                    if (owners.indexOf(email) !== -1 || pageList.indexOf(email) !== -1) {
                        if (cur) cur.remove();
                    } else {
                        accessOverlay(user.email, page);
                    }
                }).catch(function () {
                    // Can't verify the allowlist — keep unverified guests out.
                    accessOverlay(user.email, page);
                });
            });
        } catch (e) { /* page without working firebase — nothing to gate */ }
    }
    initAccessGate();

    // ── Sticky table headers: measure how much of the top stays pinned while
    //    scrolling (site-switcher and/or page header) and expose it as
    //    --sticky-top so thead cells can stick right below the pinned bars.
    function updateStickyTop() {
        var bottom = 0;
        var bars = document.querySelectorAll('.site-switcher, header');
        for (var i = 0; i < bars.length; i++) {
            var cs = getComputedStyle(bars[i]);
            if (cs.position === 'sticky' || cs.position === 'fixed') {
                var topOffset = parseFloat(cs.top) || 0;
                bottom = Math.max(bottom, topOffset + bars[i].getBoundingClientRect().height);
            }
        }
        document.documentElement.style.setProperty('--sticky-top', bottom + 'px');
    }
    updateStickyTop();
    window.addEventListener('resize', updateStickyTop);
    setTimeout(updateStickyTop, 400);   // re-measure after fonts/wrapping settle
    // Bars change size when the app appears after sign-in (the page header is
    // hidden behind the login screen) — observe them so the offset stays true.
    if (window.ResizeObserver) {
        var ro = new ResizeObserver(updateStickyTop);
        document.querySelectorAll('.site-switcher, header').forEach(function (el) { ro.observe(el); });
    }
})();
