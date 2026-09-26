static void free_leaf(Leaf *l) { free(l->text); free(l->starts.v); free(l->ends.v); }
int main(void) {
  uint32_t seed=11;
  uint16_t text[1024];
  Document actual={0},expected={0};actual.text=text;expected.text=text;
  const uint16_t specials[]={0,9,10,13,32,127,128,255,0x5d0,0x4e2d,0xd800,0xdbff,0xdc00,0xdfff,0xffff};
  for (uint32_t round=0;round<20000;round++) {
    for(uint32_t j=0;j<1024;j++) {
      seed=seed*1664525+1013904223;
      text[j]=(seed%5) ? (uint16_t)(32+seed%95) : specials[seed%15];
    }
    uint32_t a=seed%256,b=a+((seed>>9)%(1025-a));
    leaf_single(&actual,a,b);
    expected.leaf.n=expected.leaf.starts.n=expected.leaf.ends.n=0;
    bool line_start=true;
    slow_lines(&expected,a,b,&line_start);
    word(&expected.leaf.starts,b);
    assert(actual.leaf.n==expected.leaf.n);
    assert(actual.leaf.starts.n==expected.leaf.starts.n);
    assert(actual.leaf.ends.n==expected.leaf.ends.n);
    if(actual.leaf.n) assert(!memcmp(actual.leaf.text,expected.leaf.text,actual.leaf.n));
    assert(!memcmp(actual.leaf.starts.v,expected.leaf.starts.v,actual.leaf.starts.n*sizeof(uint32_t)));
    if(actual.leaf.ends.n) assert(!memcmp(actual.leaf.ends.v,expected.leaf.ends.v,actual.leaf.ends.n*sizeof(uint32_t)));
  }
  free_leaf(&actual.leaf);free_leaf(&expected.leaf);
  puts("20,000 UTF-16 slices: UTF-8 bytes and every start/end mapping identical to scalar oracle");
}
