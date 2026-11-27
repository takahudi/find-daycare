export default {
  extends: ['stylelint-config-standard'],
  overrides: [
    {
      files: ['**/*.module.css'],
      rules: {
        // CSS Modules の camelCase と :global() 内の外部クラスの kebab-case を許容する。
        'selector-class-pattern': '^[a-z][a-zA-Z0-9]*(-[a-z0-9]+)*$',
        // 外部ライブラリのクラスは CSS Modules のスコープ変換から除外する。
        'selector-pseudo-class-no-unknown': [true, { ignorePseudoClasses: ['global'] }],
      },
    },
  ],
};
