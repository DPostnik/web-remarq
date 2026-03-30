use serde::Deserialize;
use swc_core::{
    common::{SourceMapper, DUMMY_SP},
    ecma::{
        ast::*,
        visit::{VisitMut, VisitMutWith},
    },
    plugin::{
        metadata::TransformPluginMetadataContextKind, plugin_transform,
        proxies::{PluginSourceMapProxy, TransformPluginProgramMetadata},
    },
};

#[derive(Debug, Default, Deserialize)]
#[allow(dead_code)]
struct Config {
    #[serde(default)]
    production: Option<bool>,
}

/// Tracks the parent context stack for component name resolution.
/// Since SWC's VisitMut doesn't have Babel's parentPath, we maintain this manually.
#[derive(Clone, Debug)]
enum ParentContext {
    FunctionDeclaration(Option<String>),
    VariableDeclarator(String),
    ClassDeclaration(String),
    #[allow(dead_code)]
    ExportDefault,
    #[allow(dead_code)]
    ExportNamed,
    Other,
}

struct WebRemarqVisitor {
    file_path: String,
    source_map: PluginSourceMapProxy,
    parent_stack: Vec<ParentContext>,
}

impl WebRemarqVisitor {
    fn new(file_path: String, source_map: PluginSourceMapProxy) -> Self {
        Self {
            file_path,
            source_map,
            parent_stack: Vec::new(),
        }
    }

    /// Walk up the parent stack to find the nearest component name.
    /// Mirrors the Babel plugin's findComponentName logic:
    /// - FunctionDeclaration with name
    /// - VariableDeclarator (covers `const Comp = () => ...` and `const Comp = memo(() => ...)`)
    /// - ClassDeclaration with name
    fn find_component_name(&self) -> Option<String> {
        for ctx in self.parent_stack.iter().rev() {
            match ctx {
                ParentContext::FunctionDeclaration(Some(name)) => return Some(name.clone()),
                ParentContext::VariableDeclarator(name) => return Some(name.clone()),
                ParentContext::ClassDeclaration(name) => return Some(name.clone()),
                _ => continue,
            }
        }
        None
    }

    /// Check if the element already has a data-remarq-source attribute.
    fn has_remarq_source(el: &JSXOpeningElement) -> bool {
        el.attrs.iter().any(|attr| {
            if let JSXAttrOrSpread::JSXAttr(jsx_attr) = attr {
                if let JSXAttrName::Ident(ident_name) = &jsx_attr.name {
                    return ident_name.sym.as_ref() == "data-remarq-source";
                }
            }
            false
        })
    }

    /// Check if the JSX element is a fragment (<> or <React.Fragment>).
    fn is_fragment(name: &JSXElementName) -> bool {
        match name {
            // Empty identifier = JSX fragment shorthand <>
            JSXElementName::Ident(ident) if ident.sym.as_ref() == "" => true,
            // <React.Fragment> or <Foo.Fragment>
            JSXElementName::JSXMemberExpr(member) => member.prop.sym.as_ref() == "Fragment",
            _ => false,
        }
    }

    /// Create a JSX string attribute: name="value"
    fn make_jsx_str_attr(name: &str, value: &str) -> JSXAttrOrSpread {
        JSXAttrOrSpread::JSXAttr(JSXAttr {
            span: DUMMY_SP,
            name: JSXAttrName::Ident(IdentName {
                span: DUMMY_SP,
                sym: name.into(),
            }),
            value: Some(JSXAttrValue::Str(Str {
                span: DUMMY_SP,
                value: value.into(),
                raw: None,
            })),
        })
    }
}

impl VisitMut for WebRemarqVisitor {
    // --- Parent stack tracking ---

    fn visit_mut_fn_decl(&mut self, n: &mut FnDecl) {
        let name = n.ident.sym.as_ref().to_string();
        let ctx = if name.is_empty() {
            ParentContext::FunctionDeclaration(None)
        } else {
            ParentContext::FunctionDeclaration(Some(name))
        };
        self.parent_stack.push(ctx);
        n.visit_mut_children_with(self);
        self.parent_stack.pop();
    }

    fn visit_mut_fn_expr(&mut self, n: &mut FnExpr) {
        let ctx = match &n.ident {
            Some(ident) if !ident.sym.as_ref().is_empty() => {
                ParentContext::FunctionDeclaration(Some(ident.sym.as_ref().to_string()))
            }
            _ => ParentContext::Other,
        };
        self.parent_stack.push(ctx);
        n.visit_mut_children_with(self);
        self.parent_stack.pop();
    }

    fn visit_mut_arrow_expr(&mut self, n: &mut ArrowExpr) {
        self.parent_stack.push(ParentContext::Other);
        n.visit_mut_children_with(self);
        self.parent_stack.pop();
    }

    fn visit_mut_var_declarator(&mut self, n: &mut VarDeclarator) {
        if let Pat::Ident(bind_ident) = &n.name {
            let name = bind_ident.sym.as_ref().to_string();
            if !name.is_empty() {
                self.parent_stack
                    .push(ParentContext::VariableDeclarator(name));
                n.visit_mut_children_with(self);
                self.parent_stack.pop();
                return;
            }
        }
        n.visit_mut_children_with(self);
    }

    fn visit_mut_class_decl(&mut self, n: &mut ClassDecl) {
        let name = n.ident.sym.as_ref().to_string();
        if !name.is_empty() {
            self.parent_stack
                .push(ParentContext::ClassDeclaration(name));
        } else {
            self.parent_stack.push(ParentContext::Other);
        }
        n.visit_mut_children_with(self);
        self.parent_stack.pop();
    }

    fn visit_mut_export_default_decl(&mut self, n: &mut ExportDefaultDecl) {
        self.parent_stack.push(ParentContext::ExportDefault);
        n.visit_mut_children_with(self);
        self.parent_stack.pop();
    }

    fn visit_mut_export_decl(&mut self, n: &mut ExportDecl) {
        self.parent_stack.push(ParentContext::ExportNamed);
        n.visit_mut_children_with(self);
        self.parent_stack.pop();
    }

    // --- JSX transformation ---

    fn visit_mut_jsx_opening_element(&mut self, el: &mut JSXOpeningElement) {
        // Visit children first (nested JSX)
        el.visit_mut_children_with(self);

        // Skip fragments
        if Self::is_fragment(&el.name) {
            return;
        }

        // Skip already annotated
        if Self::has_remarq_source(el) {
            return;
        }

        // Get line:col via the SourceMap proxy (proper SWC approach).
        // lookup_char_pos returns 1-based line and 0-based column (CharPos).
        let loc = self.source_map.lookup_char_pos(el.span.lo);
        let line = loc.line; // 1-based
        let col = loc.col.0; // 0-based (CharPos)

        // Inject data-remarq-source="path:line:col"
        let source_value = format!("{}:{}:{}", self.file_path, line, col);
        el.attrs
            .push(Self::make_jsx_str_attr("data-remarq-source", &source_value));

        // Inject data-remarq-component="ComponentName" if found
        if let Some(component_name) = self.find_component_name() {
            el.attrs.push(Self::make_jsx_str_attr(
                "data-remarq-component",
                &component_name,
            ));
        }
    }
}

/// SWC plugin entry point.
#[plugin_transform]
fn web_remarq_plugin(mut program: Program, data: TransformPluginProgramMetadata) -> Program {
    let _config: Config = serde_json::from_str(
        &data
            .get_transform_plugin_config()
            .unwrap_or_else(|| "{}".to_string()),
    )
    .unwrap_or_default();

    // Compute relative file path with forward slashes
    let file_path = match data.get_context(&TransformPluginMetadataContextKind::Filename) {
        Some(name) => {
            let cwd = data
                .get_context(&TransformPluginMetadataContextKind::Cwd)
                .unwrap_or_default();
            let path = name.strip_prefix(&cwd).unwrap_or(&name);
            let path = path.strip_prefix('/').unwrap_or(path);
            path.replace('\\', "/")
        }
        None => "unknown".to_string(),
    };

    // Use the PluginSourceMapProxy for line:col resolution.
    // This proxy calls back into the SWC host to convert BytePos -> Loc.
    let source_map = data.source_map.clone();

    let mut visitor = WebRemarqVisitor::new(file_path, source_map);
    program.visit_mut_with(&mut visitor);
    program
}
