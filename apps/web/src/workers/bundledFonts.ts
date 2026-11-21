import iosevkaBold from "~~/public/fonts/code/IosevkaConcreteCode-Bold.ttf?url";
import iosevkaBoldItalic from "~~/public/fonts/code/IosevkaConcreteCode-BoldItalic.ttf?url";
import iosevkaItalic from "~~/public/fonts/code/IosevkaConcreteCode-Italic.ttf?url";
import iosevka from "~~/public/fonts/code/IosevkaConcreteCode-Regular.ttf?url";
import concreteMathBold from "~~/public/fonts/math/ConcreteMath-Bold.otf?url";
import concreteMath from "~~/public/fonts/math/ConcreteMath-Regular.otf?url";
import iosevkaTextBold from "~~/public/fonts/text/IosevkaConcreteText-Bold.ttf?url";
import iosevkaTextBoldItalic from "~~/public/fonts/text/IosevkaConcreteText-BoldItalic.ttf?url";
import iosevkaTextItalic from "~~/public/fonts/text/IosevkaConcreteText-Italic.ttf?url";
import iosevkaText from "~~/public/fonts/text/IosevkaConcreteText-Regular.ttf?url";

/**
 * Font URLs every worker installs. Keep in sync with `getTypstFontImports`
 * in `composables/typst.ts`.
 */
export const BUNDLED_FONT_URLS: string[] = [
  iosevka,
  iosevkaItalic,
  iosevkaBold,
  iosevkaBoldItalic,
  iosevkaText,
  iosevkaTextItalic,
  iosevkaTextBold,
  iosevkaTextBoldItalic,
  concreteMath,
  concreteMathBold,
];
