package githubbroker

import (
	"fmt"
	"strings"
)

// This file implements a small structural GraphQL parser for the
// executable subset gh uses (operations, fragments, variables, aliases,
// directives, arguments). The broker parses every GraphQL request and
// authorizes it by shape; it never pattern-matches raw query text for
// security decisions.

type gqlValueKind int

const (
	vNull gqlValueKind = iota
	vVariable
	vString
	vInt
	vFloat
	vBool
	vEnum
	vList
	vObject
)

// GQLValue is a parsed argument or variable-default value.
type GQLValue struct {
	Kind   gqlValueKind
	Str    string              // variable name, string, enum, number text
	List   []GQLValue          // vList
	Object map[string]GQLValue // vObject
	Bool   bool                // vBool
}

// GQLField is one field selection.
type GQLField struct {
	Alias      string
	Name       string
	Args       map[string]GQLValue
	Selections []GQLSelection
}

// GQLSelection is a field, fragment spread, or inline fragment.
type GQLSelection struct {
	Field          *GQLField
	FragmentSpread string
	Inline         *GQLInlineFragment
}

// GQLInlineFragment is an inline fragment selection set. The broker
// treats directives as opaque and conservatively assumes the selection
// applies.
type GQLInlineFragment struct {
	Selections []GQLSelection
}

// GQLOperation is one executable operation definition.
type GQLOperation struct {
	Type        string // "query", "mutation", or "subscription"
	Name        string
	VarDefaults map[string]GQLValue
	Selections  []GQLSelection
}

// GQLFragment is a named fragment definition.
type GQLFragment struct {
	Name       string
	Selections []GQLSelection
}

// GQLDocument is a parsed GraphQL request document.
type GQLDocument struct {
	Operations []*GQLOperation
	Fragments  map[string]*GQLFragment
}

type gqlToken struct {
	kind rune // 'name', 'str', 'num', 'punct', 'spread'
	val  string
}

type gqlLexer struct {
	src  string
	pos  int
	toks []gqlToken
}

func lexGraphQL(src string) ([]gqlToken, error) {
	l := &gqlLexer{src: src}
	for l.pos < len(l.src) {
		c := l.src[l.pos]
		switch {
		case c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == ',':
			l.pos++
		case c == 0xEF && l.pos+2 < len(l.src) && l.src[l.pos+1] == 0xBB && l.src[l.pos+2] == 0xBF:
			l.pos += 3 // UTF-8 BOM
		case c == '#':
			for l.pos < len(l.src) && l.src[l.pos] != '\n' {
				l.pos++
			}
		case c == '.':
			if l.pos+2 < len(l.src) && l.src[l.pos+1] == '.' && l.src[l.pos+2] == '.' {
				l.toks = append(l.toks, gqlToken{kind: '.', val: "..."})
				l.pos += 3
			} else {
				return nil, fmt.Errorf("unexpected '.' at %d", l.pos)
			}
		case c == '"':
			s, err := l.lexString()
			if err != nil {
				return nil, err
			}
			l.toks = append(l.toks, gqlToken{kind: 's', val: s})
		case c == '$' || c == '!' || c == '(' || c == ')' || c == ':' ||
			c == '=' || c == '@' || c == '[' || c == ']' || c == '{' ||
			c == '}' || c == '|' || c == '&':
			l.toks = append(l.toks, gqlToken{kind: rune(c), val: string(c)})
			l.pos++
		case c == '-' || (c >= '0' && c <= '9'):
			start := l.pos
			l.pos++
			for l.pos < len(l.src) && strings.ContainsRune("0123456789.eE+-", rune(l.src[l.pos])) {
				l.pos++
			}
			l.toks = append(l.toks, gqlToken{kind: 'n', val: l.src[start:l.pos]})
		case c == '_' || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z'):
			start := l.pos
			for l.pos < len(l.src) {
				d := l.src[l.pos]
				if d == '_' || (d >= 'A' && d <= 'Z') || (d >= 'a' && d <= 'z') || (d >= '0' && d <= '9') {
					l.pos++
				} else {
					break
				}
			}
			l.toks = append(l.toks, gqlToken{kind: 'w', val: l.src[start:l.pos]})
		default:
			return nil, fmt.Errorf("unexpected character %q at %d", c, l.pos)
		}
	}
	return l.toks, nil
}

func (l *gqlLexer) lexString() (string, error) {
	// Block string.
	if strings.HasPrefix(l.src[l.pos:], `"""`) {
		end := strings.Index(l.src[l.pos+3:], `"""`)
		if end < 0 {
			return "", fmt.Errorf("unterminated block string")
		}
		s := l.src[l.pos+3 : l.pos+3+end]
		l.pos += 3 + end + 3
		return s, nil
	}
	l.pos++ // opening quote
	var b strings.Builder
	for l.pos < len(l.src) {
		c := l.src[l.pos]
		switch c {
		case '"':
			l.pos++
			return b.String(), nil
		case '\\':
			if l.pos+1 >= len(l.src) {
				return "", fmt.Errorf("unterminated escape")
			}
			e := l.src[l.pos+1]
			switch e {
			case '"', '\\', '/':
				b.WriteByte(e)
			case 'n':
				b.WriteByte('\n')
			case 't':
				b.WriteByte('\t')
			case 'r':
				b.WriteByte('\r')
			case 'b':
				b.WriteByte('\b')
			case 'f':
				b.WriteByte('\f')
			case 'u':
				if l.pos+5 >= len(l.src) {
					return "", fmt.Errorf("short unicode escape")
				}
				var r rune
				if _, err := fmt.Sscanf(l.src[l.pos+2:l.pos+6], "%04x", &r); err != nil {
					return "", fmt.Errorf("bad unicode escape")
				}
				b.WriteRune(r)
				l.pos += 4
			default:
				return "", fmt.Errorf("bad escape %q", e)
			}
			l.pos += 2
		case '\n':
			return "", fmt.Errorf("newline in string")
		default:
			b.WriteByte(c)
			l.pos++
		}
	}
	return "", fmt.Errorf("unterminated string")
}

type gqlParser struct {
	toks []gqlToken
	pos  int
}

func (p *gqlParser) peek() (gqlToken, bool) {
	if p.pos < len(p.toks) {
		return p.toks[p.pos], true
	}
	return gqlToken{}, false
}

func (p *gqlParser) next() (gqlToken, error) {
	t, ok := p.peek()
	if !ok {
		return gqlToken{}, fmt.Errorf("unexpected end of document")
	}
	p.pos++
	return t, nil
}

func (p *gqlParser) expectPunct(c rune) error {
	t, err := p.next()
	if err != nil {
		return err
	}
	if t.kind != c || len(t.val) != 1 {
		return fmt.Errorf("expected %q, got %q", string(c), t.val)
	}
	return nil
}

func (p *gqlParser) expectWord() (string, error) {
	t, err := p.next()
	if err != nil {
		return "", err
	}
	if t.kind != 'w' {
		return "", fmt.Errorf("expected name, got %q", t.val)
	}
	return t.val, nil
}

// ParseGraphQL parses the executable subset of GraphQL. Anything outside
// the subset (schema definitions, type system extensions) is an error,
// which the broker treats as a denial.
func ParseGraphQL(src string) (*GQLDocument, error) {
	toks, err := lexGraphQL(src)
	if err != nil {
		return nil, err
	}
	p := &gqlParser{toks: toks}
	doc := &GQLDocument{Fragments: map[string]*GQLFragment{}}
	for {
		if _, ok := p.peek(); !ok {
			break
		}
		t, _ := p.peek()
		switch {
		case t.kind == '{':
			op, err := p.parseOperation("")
			if err != nil {
				return nil, err
			}
			doc.Operations = append(doc.Operations, op)
		case t.kind == 'w' && (t.val == "query" || t.val == "mutation" || t.val == "subscription"):
			opType := t.val
			p.pos++
			op, err := p.parseOperation(opType)
			if err != nil {
				return nil, err
			}
			doc.Operations = append(doc.Operations, op)
		case t.kind == 'w' && t.val == "fragment":
			p.pos++
			frag, err := p.parseFragment()
			if err != nil {
				return nil, err
			}
			if _, dup := doc.Fragments[frag.Name]; dup {
				return nil, fmt.Errorf("duplicate fragment %q", frag.Name)
			}
			doc.Fragments[frag.Name] = frag
		default:
			return nil, fmt.Errorf("unsupported definition %q", t.val)
		}
	}
	if len(doc.Operations) == 0 {
		return nil, fmt.Errorf("no operation in document")
	}
	return doc, nil
}

func (p *gqlParser) parseOperation(opType string) (*GQLOperation, error) {
	op := &GQLOperation{Type: opType, VarDefaults: map[string]GQLValue{}}
	if opType == "" {
		op.Type = "query"
	}
	// Optional name.
	if t, ok := p.peek(); ok && t.kind == 'w' {
		op.Name = t.val
		p.pos++
	}
	// Optional variable definitions.
	if t, ok := p.peek(); ok && t.kind == '(' {
		p.pos++
		for {
			if t, _ := p.peek(); t.kind == ')' {
				p.pos++
				break
			}
			if err := p.expectPunct('$'); err != nil {
				return nil, err
			}
			name, err := p.expectWord()
			if err != nil {
				return nil, err
			}
			if err := p.expectPunct(':'); err != nil {
				return nil, err
			}
			if err := p.skipType(); err != nil {
				return nil, err
			}
			if t, _ := p.peek(); t.kind == '=' {
				p.pos++
				v, err := p.parseValue()
				if err != nil {
					return nil, err
				}
				op.VarDefaults[name] = v
			}
			// Directives on variable definitions are consumed generically.
			if err := p.skipDirectives(); err != nil {
				return nil, err
			}
		}
	}
	if err := p.skipDirectives(); err != nil {
		return nil, err
	}
	sel, err := p.parseSelectionSet()
	if err != nil {
		return nil, err
	}
	op.Selections = sel
	return op, nil
}

// skipType consumes a type reference: Named, [List], with ! modifiers.
func (p *gqlParser) skipType() error {
	t, err := p.next()
	if err != nil {
		return err
	}
	switch {
	case t.kind == 'w':
	case t.kind == '[':
		if err := p.skipType(); err != nil {
			return err
		}
		if err := p.expectPunct(']'); err != nil {
			return err
		}
	default:
		return fmt.Errorf("expected type, got %q", t.val)
	}
	if t, _ := p.peek(); t.kind == '!' {
		p.pos++
	}
	return nil
}

func (p *gqlParser) skipDirectives() error {
	for {
		t, _ := p.peek()
		if t.kind != '@' {
			return nil
		}
		p.pos++
		if _, err := p.expectWord(); err != nil {
			return err
		}
		if t, _ := p.peek(); t.kind == '(' {
			if _, err := p.parseArguments(); err != nil {
				return err
			}
		}
	}
}

func (p *gqlParser) parseFragment() (*GQLFragment, error) {
	name, err := p.expectWord()
	if err != nil {
		return nil, err
	}
	if name == "on" {
		return nil, fmt.Errorf("fragment name cannot be \"on\"")
	}
	on, err := p.expectWord()
	if err != nil {
		return nil, err
	}
	if on != "on" {
		return nil, fmt.Errorf("expected \"on\" in fragment %q", name)
	}
	if _, err := p.expectWord(); err != nil { // type condition
		return nil, err
	}
	if err := p.skipDirectives(); err != nil {
		return nil, err
	}
	sel, err := p.parseSelectionSet()
	if err != nil {
		return nil, err
	}
	return &GQLFragment{Name: name, Selections: sel}, nil
}

func (p *gqlParser) parseSelectionSet() ([]GQLSelection, error) {
	if err := p.expectPunct('{'); err != nil {
		return nil, err
	}
	var sels []GQLSelection
	for {
		t, ok := p.peek()
		if !ok {
			return nil, fmt.Errorf("unterminated selection set")
		}
		if t.kind == '}' {
			p.pos++
			break
		}
		sel, err := p.parseSelection()
		if err != nil {
			return nil, err
		}
		sels = append(sels, sel)
	}
	if len(sels) == 0 {
		return nil, fmt.Errorf("empty selection set")
	}
	return sels, nil
}

func (p *gqlParser) parseSelection() (GQLSelection, error) {
	t, err := p.next()
	if err != nil {
		return GQLSelection{}, err
	}
	if t.kind == '.' {
		// Fragment spread or inline fragment.
		nt, err := p.next()
		if err != nil {
			return GQLSelection{}, err
		}
		switch {
		case nt.kind == 'w' && nt.val == "on":
			if _, err := p.expectWord(); err != nil { // type condition
				return GQLSelection{}, err
			}
			if err := p.skipDirectives(); err != nil {
				return GQLSelection{}, err
			}
			sel, err := p.parseSelectionSet()
			if err != nil {
				return GQLSelection{}, err
			}
			return GQLSelection{Inline: &GQLInlineFragment{Selections: sel}}, nil
		case nt.kind == '@':
			// Inline fragment without type condition: ... @dir { ... }
			p.pos-- // let skipDirectives see '@'
			if err := p.skipDirectives(); err != nil {
				return GQLSelection{}, err
			}
			sel, err := p.parseSelectionSet()
			if err != nil {
				return GQLSelection{}, err
			}
			return GQLSelection{Inline: &GQLInlineFragment{Selections: sel}}, nil
		case nt.kind == 'w':
			if err := p.skipDirectives(); err != nil {
				return GQLSelection{}, err
			}
			return GQLSelection{FragmentSpread: nt.val}, nil
		default:
			return GQLSelection{}, fmt.Errorf("bad fragment syntax")
		}
	}
	// Field: [alias ':'] name [args] [directives] [selectionSet]
	if t.kind != 'w' {
		return GQLSelection{}, fmt.Errorf("expected field name, got %q", t.val)
	}
	field := &GQLField{Name: t.val}
	if nt, _ := p.peek(); nt.kind == ':' {
		p.pos++
		field.Alias = field.Name
		name, err := p.expectWord()
		if err != nil {
			return GQLSelection{}, err
		}
		field.Name = name
	}
	if nt, _ := p.peek(); nt.kind == '(' {
		args, err := p.parseArguments()
		if err != nil {
			return GQLSelection{}, err
		}
		field.Args = args
	}
	if err := p.skipDirectives(); err != nil {
		return GQLSelection{}, err
	}
	if nt, _ := p.peek(); nt.kind == '{' {
		sel, err := p.parseSelectionSet()
		if err != nil {
			return GQLSelection{}, err
		}
		field.Selections = sel
	}
	return GQLSelection{Field: field}, nil
}

func (p *gqlParser) parseArguments() (map[string]GQLValue, error) {
	if err := p.expectPunct('('); err != nil {
		return nil, err
	}
	args := map[string]GQLValue{}
	for {
		if t, _ := p.peek(); t.kind == ')' {
			p.pos++
			return args, nil
		}
		name, err := p.expectWord()
		if err != nil {
			return nil, err
		}
		if err := p.expectPunct(':'); err != nil {
			return nil, err
		}
		v, err := p.parseValue()
		if err != nil {
			return nil, err
		}
		args[name] = v
	}
}

func (p *gqlParser) parseValue() (GQLValue, error) {
	t, err := p.next()
	if err != nil {
		return GQLValue{}, err
	}
	switch {
	case t.kind == '$':
		name, err := p.expectWord()
		if err != nil {
			return GQLValue{}, err
		}
		return GQLValue{Kind: vVariable, Str: name}, nil
	case t.kind == 's':
		return GQLValue{Kind: vString, Str: t.val}, nil
	case t.kind == 'n':
		if strings.ContainsAny(t.val, ".eE") {
			return GQLValue{Kind: vFloat, Str: t.val}, nil
		}
		return GQLValue{Kind: vInt, Str: t.val}, nil
	case t.kind == 'w':
		switch t.val {
		case "true":
			return GQLValue{Kind: vBool, Bool: true}, nil
		case "false":
			return GQLValue{Kind: vBool}, nil
		case "null":
			return GQLValue{Kind: vNull}, nil
		default:
			return GQLValue{Kind: vEnum, Str: t.val}, nil
		}
	case t.kind == '[':
		v := GQLValue{Kind: vList}
		for {
			if nt, _ := p.peek(); nt.kind == ']' {
				p.pos++
				return v, nil
			}
			item, err := p.parseValue()
			if err != nil {
				return GQLValue{}, err
			}
			v.List = append(v.List, item)
		}
	case t.kind == '{':
		v := GQLValue{Kind: vObject, Object: map[string]GQLValue{}}
		for {
			if nt, _ := p.peek(); nt.kind == '}' {
				p.pos++
				return v, nil
			}
			name, err := p.expectWord()
			if err != nil {
				return GQLValue{}, err
			}
			if err := p.expectPunct(':'); err != nil {
				return GQLValue{}, err
			}
			item, err := p.parseValue()
			if err != nil {
				return GQLValue{}, err
			}
			v.Object[name] = item
		}
	default:
		return GQLValue{}, fmt.Errorf("unexpected value token %q", t.val)
	}
}

// RootFields flattens an operation's root selection set into fields,
// expanding fragment spreads and inline fragments. Cycles and runaway
// depth are errors, which the broker treats as denials.
func (d *GQLDocument) RootFields(op *GQLOperation) ([]*GQLField, error) {
	var fields []*GQLField
	visited := map[string]bool{}
	var walk func(sels []GQLSelection, depth int) error
	walk = func(sels []GQLSelection, depth int) error {
		if depth > 64 {
			return fmt.Errorf("fragment nesting too deep")
		}
		for _, sel := range sels {
			switch {
			case sel.Field != nil:
				fields = append(fields, sel.Field)
			case sel.Inline != nil:
				if err := walk(sel.Inline.Selections, depth+1); err != nil {
					return err
				}
			case sel.FragmentSpread != "":
				if visited[sel.FragmentSpread] {
					return fmt.Errorf("fragment cycle at %q", sel.FragmentSpread)
				}
				frag, ok := d.Fragments[sel.FragmentSpread]
				if !ok {
					return fmt.Errorf("undefined fragment %q", sel.FragmentSpread)
				}
				visited[sel.FragmentSpread] = true
				if err := walk(frag.Selections, depth+1); err != nil {
					return err
				}
				delete(visited, sel.FragmentSpread)
			}
		}
		return nil
	}
	if err := walk(op.Selections, 0); err != nil {
		return nil, err
	}
	return fields, nil
}

// ResolveString reduces a value to a string using request variables and
// operation variable defaults. ok is false for non-string or
// unresolvable values.
func ResolveString(v GQLValue, vars map[string]any, defaults map[string]GQLValue) (string, bool) {
	switch v.Kind {
	case vString:
		return v.Str, true
	case vEnum:
		return v.Str, true
	case vInt:
		return v.Str, true
	case vVariable:
		if vars != nil {
			if s, ok := vars[v.Str].(string); ok {
				return s, true
			}
			if f, ok := vars[v.Str].(float64); ok {
				return fmt.Sprintf("%v", f), true
			}
		}
		if d, ok := defaults[v.Str]; ok && d.Kind != vVariable {
			return ResolveString(d, nil, nil)
		}
		return "", false
	default:
		return "", false
	}
}
