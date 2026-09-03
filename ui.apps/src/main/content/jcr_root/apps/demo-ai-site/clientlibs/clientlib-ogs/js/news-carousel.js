(function () {
  function init(root) {
    var track = root.querySelector('.cmp-ogs-news__track');
    var prev = root.querySelector('.cmp-ogs-news__arrow--prev');
    var next = root.querySelector('.cmp-ogs-news__arrow--next');
    if (!track || !prev || !next) return;

    function step() {
      var first = track.querySelector('.cmp-ogs-news__card');
      if (!first) return 320;
      var gap = parseFloat(getComputedStyle(track).columnGap || getComputedStyle(track).gap || '20');
      return first.getBoundingClientRect().width + gap;
    }
    function update() {
      var maxLeft = track.scrollWidth - track.clientWidth - 1;
      prev.disabled = track.scrollLeft <= 0;
      next.disabled = track.scrollLeft >= maxLeft;
    }
    prev.addEventListener('click', function () { track.scrollBy({ left: -step(), behavior: 'smooth' }); });
    next.addEventListener('click', function () { track.scrollBy({ left: step(), behavior: 'smooth' }); });
    track.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
  }
  function ready() {
    document.querySelectorAll('[data-cmp-is="ogs-news-carousel"]').forEach(init);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ready);
  } else { ready(); }
})();
