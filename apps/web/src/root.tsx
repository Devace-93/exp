import { component$ } from "@builder.io/qwik";
import { QwikCityProvider, RouterOutlet } from "@builder.io/qwik-city";
import { RouterHead } from "./components/router-head";
import "./global.css";

export default component$(() => {
  /**
   * The root of the Qwik City app. <head> + <body> live here; per-route chrome
   * (marketing nav / dashboard nav) is provided by the layouts under src/routes.
   */
  return (
    <QwikCityProvider>
      <head>
        <meta charSet="utf-8" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="manifest" href="/manifest.json" />
        <RouterHead />
        {/* Apply the saved theme / language before first paint (no flash). Same
            localStorage keys as the other 3m4 apps. */}
        <script
          dangerouslySetInnerHTML={`try{var t=localStorage.getItem("3m4.theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t;var l=localStorage.getItem("3m4.lang");if(l){document.documentElement.lang=l;document.documentElement.dir=l.slice(0,2)==="ar"?"rtl":"ltr"}}catch(e){}`}
        />
      </head>
      <body class="min-h-screen bg-white">
        <RouterOutlet />
      </body>
    </QwikCityProvider>
  );
});
