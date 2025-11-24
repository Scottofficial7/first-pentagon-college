(function($) {

    "use strict";

      // background color when scroll 
  var initScrollNav = function () {
    var scroll = $(window).scrollTop();

    if (scroll >= 200) {
      $('.navbar.second-header').addClass("bg-dark");
      $('.navbar.second-header').addClass("hidden");
      $('.header-top.first-header').addClass("hidden");
    } else {
      $('.navbar.second-header').removeClass("bg-dark");
      $('.navbar.second-header').removeClass("hidden");
      $('.header-top.first-header').removeClass("hidden");
    }
  }

  $(window).scroll(function () {
    initScrollNav();
  });

    $(document).ready(function() {

      // Facilities Swiper for mobile only
      if (window.innerWidth < 768) {
        var facilitiesSwiper = new Swiper('.facilities-swiper', {
          slidesPerView: 1,
          spaceBetween: 0,
          pagination: {
            el: '.facilities-swiper .swiper-pagination',
            clickable: true,
          },
        });
      }

      /* Video */
      var $videoSrc;  
        $('.play-btn').click(function() {
          $videoSrc = $(this).data( "src" );
        });

        $('#myModal').on('shown.bs.modal', function (e) {

        $("#video").attr('src',$videoSrc + "?autoplay=1&amp;modestbranding=1&amp;showinfo=0" ); 
      })

      $('#myModal').on('hide.bs.modal', function (e) {
        $("#video").attr('src',$videoSrc); 
      })
        
      var swiper = new Swiper(".slider", {
        effect: "fade",
        loop: true,
        autoplay: {
          delay: 4000,
          disableOnInteraction: false,
        },
        navigation: {
          nextEl: ".main-slider-button-next",
          prevEl: ".main-slider-button-prev",
        },
      });

      var swiper = new Swiper(".testimonial-swiper", {
        slidesPerView: 3,
        spaceBetween: 20,
        pagination: {
          el: ".swiper-pagination",
          clickable: true,
        },
        breakpoints: {
          0: {
            slidesPerView: 1,
          },
          640: {
            slidesPerView: 2,
          },
          1024: {
            slidesPerView: 3,
          },
        },
      });

    }); // End of a document

})(jQuery);