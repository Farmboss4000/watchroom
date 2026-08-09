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
        ['bills.html',      '🧾', 'Bills'],
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
