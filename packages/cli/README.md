# @typbase/cli

Verify and publish Typbase themes and plugins.

```sh
typbase theme init my-theme
typbase theme verify my-theme/theme.json --strict
typbase theme publish my-theme/theme.json --identifier you.bsky.social

typbase plugin init my-plugin
typbase plugin verify my-plugin
typbase plugin build my-plugin
typbase plugin publish my-plugin --identifier you.bsky.social
```

Publishing accepts `--password` or `ATP_PASSWORD`, and `--service` or
`ATP_SERVICE`. The default service is `https://bsky.social`. Use an app
password, not your account password.

The theme and plugin validators come from `@typbase/skin` and
`@typbase/plugin-sdk`, so the app, registry, and CLI reject the same input.
