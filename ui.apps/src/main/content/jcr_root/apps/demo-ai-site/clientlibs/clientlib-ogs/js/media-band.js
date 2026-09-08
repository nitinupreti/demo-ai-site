(function () {
  function init(root) {
    var trigger = root.querySelector('.cmp-ogs-media-band__play');
    var modal = root.querySelector('.cmp-ogs-media-band__modal');
    var close = root.querySelector('.cmp-ogs-media-band__close');
    var video = root.querySelector('.cmp-ogs-media-band__video');
    if (!trigger || !modal || !close || !video) return;

    function openPlayer() {
      modal.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      document.body.classList.add('ogs-media-band-open');
      close.focus();
      video.play().catch(function () {});
    }

    function closePlayer() {
      video.pause();
      modal.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('ogs-media-band-open');
      trigger.focus();
    }

    trigger.addEventListener('click', openPlayer);
    close.addEventListener('click', closePlayer);
    modal.addEventListener('click', function (event) {
      if (event.target === modal) closePlayer();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !modal.hidden) closePlayer();
    });
  }

  function ready() {
    document.querySelectorAll('[data-cmp-is="ogs-media-band"]').forEach(init);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ready);
  } else {
    ready();
  }
})();