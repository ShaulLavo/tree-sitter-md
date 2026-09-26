use std::env;

fn main() {
    let src = "grammar/src";
    println!("cargo:rerun-if-changed={src}/parser.c");
    println!("cargo:rerun-if-changed={src}/scanner.c");
    let mut build = cc::Build::new();
    build
        .include(src)
        .std("c11")
        .warnings(false)
        .opt_level(3)
        .file(format!("{src}/parser.c"))
        .file(format!("{src}/scanner.c"));
    if env::var("TARGET").unwrap().starts_with("wasm32-unknown") {
        // The tree-sitter-language crate ships the libc headers a grammar may include.
        build.include(env::var("DEP_TREE_SITTER_LANGUAGE_WASM_HEADERS").unwrap());
    }
    build.compile("tree-sitter-md-grammar");
}
