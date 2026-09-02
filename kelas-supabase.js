'use strict';

window.SUPABASE_CONFIG = {
  url: 'https://pfdxurbfobvwqaxfmtlm.supabase.co',
  publishableKey: 'sb_publishable_XBk99oc2XoKPkK8OnAXxbw_Xo5UaX0a',
};

(() => {
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.matchMedia('(max-width: 700px)').matches;
  if (!isMobile || localStorage.getItem('desktop-mode-verified') === '1') return;
  const showGate = () => {
    const style = document.createElement('style'); style.textContent = '#desktopModeGate{position:fixed;inset:0;z-index:99999;display:grid;place-items:center;padding:18px;background:rgba(15,27,62,.72);font-family:system-ui,sans-serif}.desktop-gate-card{width:min(440px,100%);padding:26px 22px;border-radius:20px;background:#fff;color:#14234b;box-shadow:0 20px 60px rgba(0,0,0,.25)}.desktop-gate-card h2{margin:0 0 10px;font-size:1.35rem}.desktop-gate-card p{line-height:1.55;color:#52607d}.desktop-gate-card ol{padding-left:22px;line-height:1.7;color:#26365c}.desktop-gate-card button{width:100%;padding:12px 16px;border:0;border-radius:10px;background:#3855c8;color:#fff;font-weight:700;font-size:1rem}.desktop-gate-card small{display:block;margin-top:10px;color:#78839b;text-align:center}'; document.head.appendChild(style);
    const gate = document.createElement('div'); gate.id = 'desktopModeGate'; gate.innerHTML = '<section class="desktop-gate-card" role="dialog" aria-modal="true"><h2>Aktifkan Situs desktop</h2><p>Untuk membuka panel admin dengan tampilan lengkap, aktifkan mode desktop pada browser HP:</p><ol><li>Tekan ikon titik tiga (⋮).</li><li>Centang <strong>Situs desktop</strong>.</li><li>Kembali ke halaman ini.</li></ol><button type="button" id="desktopModeConfirm">Saya sudah mengaktifkan Situs desktop</button><small>Halaman akan dimuat ulang setelah verifikasi.</small></section>'; document.body.appendChild(gate); gate.querySelector('#desktopModeConfirm').addEventListener('click', () => { localStorage.setItem('desktop-mode-verified', '1'); window.location.reload(); });
  }; if (document.body) showGate(); else document.addEventListener('DOMContentLoaded', showGate, { once: true });
})();
