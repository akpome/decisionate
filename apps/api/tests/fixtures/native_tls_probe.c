__thread unsigned char analysis_tls[16 * 1024 * 1024];

int probe(void) {
    analysis_tls[0] += 1;
    return analysis_tls[0];
}
