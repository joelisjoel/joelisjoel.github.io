// Section tabs: on the homepage, highlight the tab for the section being read.
// (On section pages the current tab is marked in the HTML; nothing to do.)
(() => {
  const tabs = [...document.querySelectorAll('.tabs a[href^="#"]')];
  if (!tabs.length) return;
  const sections = tabs
    .map((a) => document.getElementById(a.getAttribute('href').slice(1)))
    .filter(Boolean);

  let pending = false;
  const update = () => {
    pending = false;
    const line = window.innerHeight * 0.35;
    let current = null;
    for (const s of sections) if (s.getBoundingClientRect().top <= line) current = s.id;
    tabs.forEach((a) => {
      const on = a.getAttribute('href') === `#${current}`;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'location');
      else a.removeAttribute('aria-current');
    });
  };
  const queue = () => { if (!pending) { pending = true; requestAnimationFrame(update); } };
  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', queue);
  update();
})();
