const rules = {
  attrs: {
    allow: {
      create: "true",
    },
  },
  $files: {
    bind: ["isLoggedIn", "auth.id != null"],
    allow: {
      view: "isLoggedIn",
      create: "isLoggedIn",
    },
  },
};

export default rules;
