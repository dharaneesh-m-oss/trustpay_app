/**
 * Web document shell.
 *
 * react-native-web renders into a div that only fills its parent, so without an
 * explicit 100% chain from <html> down the whole app collapses to its intrinsic
 * content width — which is exactly what it did: the entire UI rendered inside a
 * ~176px column in the top-left corner.
 *
 * This file is web-only; it has no effect on the iOS or Android builds.
 */

import { ScrollViewStyleReset } from 'expo-router/html';
import React from 'react';

export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover"
        />
        <meta name="theme-color" content="#5B5FEF" />
        <title>TrustPay</title>

        {/* Stops the body from scrolling independently of the RN ScrollViews. */}
        <ScrollViewStyleReset />

        <style dangerouslySetInnerHTML={{ __html: ROOT_STYLE }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

const ROOT_STYLE = `
html, body, #root {
  height: 100%;
  width: 100%;
  margin: 0;
  padding: 0;
}
#root {
  display: flex;
  flex-direction: column;
}
body {
  overflow: hidden;
  background-color: #F4F5F9;
  -webkit-font-smoothing: antialiased;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}
/* The app supplies its own focus treatment; the UA ring fights the design. */
* { -webkit-tap-highlight-color: transparent; }
input, textarea { outline: none; }
`;
