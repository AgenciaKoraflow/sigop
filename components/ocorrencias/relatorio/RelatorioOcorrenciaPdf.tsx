/* eslint-disable jsx-a11y/alt-text -- @react-pdf/renderer's <Image> renders into a PDF, not the DOM */
import * as React from 'react'
import { Document, Image, Page, Path, StyleSheet, Svg, Text, View } from '@react-pdf/renderer'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

import { INCIDENT_TYPE_LABELS } from '@/lib/dashboard/labels'
import type { BulkIncidentReport, IncidentReport } from '@/lib/ocorrencias/relatorio'

/**
 * A4 incident reports: one incident (`RelatorioOcorrenciaPdf`) or a whole
 * period (`RelatorioOcorrenciasLotePdf`), both built from the same page.
 * Header mirrors the operational report reference: dark banner (title,
 * subtitle, brand mark, date) followed by a light 4-column grid of key facts.
 *
 * Only imported through a dynamic `import()` (see ExportarRelatorioButton and
 * ExportarOcorrenciasLoteButton) so `@react-pdf/renderer` stays out of the
 * main bundle.
 */

const COLORS = {
  banner: '#111B33',
  bannerSubtitle: '#A9B4C8',
  gridBg: '#F8FAFC',
  label: '#475569',
  value: '#0F172A',
  text: '#1E293B',
  muted: '#64748B',
  border: '#E2E8F0',
  accent: '#2563EB',
  photoBg: '#F1F5F9',
} as const

const PAGE_PADDING = 28
const SIDE = 36

const styles = StyleSheet.create({
  page: {
    paddingTop: PAGE_PADDING,
    paddingBottom: 48,
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: COLORS.text,
  },
  // Header ------------------------------------------------------------------
  banner: {
    marginTop: -PAGE_PADDING,
    backgroundColor: COLORS.banner,
    paddingHorizontal: SIDE,
    paddingTop: 30,
    paddingBottom: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  bannerLeft: { flex: 1, paddingRight: 24 },
  title: { color: '#FFFFFF', fontFamily: 'Helvetica-Bold', fontSize: 20, lineHeight: 1.25 },
  subtitle: { color: COLORS.bannerSubtitle, fontSize: 11, marginTop: 8 },
  bannerRight: { alignItems: 'center', justifyContent: 'space-between', width: 84 },
  logo: { width: 60, height: 60, objectFit: 'contain' },
  markText: { color: '#FFFFFF', fontFamily: 'Helvetica-Bold', fontSize: 9, marginTop: 3 },
  bannerDate: { color: '#FFFFFF', fontFamily: 'Helvetica-Bold', fontSize: 10, marginTop: 8 },
  grid: {
    backgroundColor: COLORS.gridBg,
    paddingHorizontal: SIDE,
    paddingTop: 16,
    paddingBottom: 6,
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  cell: { width: '25%', paddingRight: 10, marginBottom: 12 },
  cellWide: { width: '50%' },
  cellLabel: {
    color: COLORS.label,
    fontFamily: 'Helvetica-Bold',
    fontSize: 7.5,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  cellValue: {
    color: COLORS.value,
    fontFamily: 'Helvetica-Bold',
    fontSize: 11,
    marginTop: 3,
    textTransform: 'uppercase',
  },
  // Body --------------------------------------------------------------------
  body: { paddingHorizontal: SIDE, paddingTop: 18 },
  section: { marginBottom: 18 },
  sectionTitle: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 11,
    color: COLORS.value,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingLeft: 7,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.accent,
    marginBottom: 8,
  },
  paragraph: { fontSize: 10.5, lineHeight: 1.5 },
  mutedText: { fontSize: 10, color: COLORS.muted },
  // Photos ------------------------------------------------------------------
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 },
  photoCell: { width: '50%', padding: 4 },
  photoFrame: {
    height: 170,
    backgroundColor: COLORS.photoBg,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 3,
    justifyContent: 'center',
  },
  photo: { width: '100%', height: '100%', objectFit: 'contain' },
  caption: { fontSize: 8.5, color: COLORS.muted, marginTop: 3 },
  // Offenders ---------------------------------------------------------------
  offenderCard: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 3,
    padding: 8,
    marginBottom: 8,
  },
  offenderPhoto: {
    width: 78,
    height: 96,
    borderRadius: 2,
    backgroundColor: COLORS.photoBg,
    objectFit: 'cover',
  },
  offenderPhotoEmpty: {
    width: 78,
    height: 96,
    borderRadius: 2,
    backgroundColor: COLORS.photoBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  offenderInfo: { flex: 1, marginLeft: 12 },
  offenderName: { fontFamily: 'Helvetica-Bold', fontSize: 11.5, color: COLORS.value },
  offenderNick: { fontSize: 9.5, color: COLORS.muted, marginTop: 1 },
  roleChip: {
    alignSelf: 'flex-start',
    marginTop: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: '#DBEAFE',
    color: '#1D4ED8',
    fontFamily: 'Helvetica-Bold',
    fontSize: 8,
  },
  traitRow: { flexDirection: 'row', marginTop: 3 },
  traitLabel: { width: 82, fontFamily: 'Helvetica-Bold', fontSize: 9, color: COLORS.label },
  traitValue: { flex: 1, fontSize: 9 },
  // Bulk export index -------------------------------------------------------
  indexRow: {
    flexDirection: 'row',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  indexHead: { backgroundColor: COLORS.gridBg },
  indexHeadText: { fontFamily: 'Helvetica-Bold', fontSize: 8, color: COLORS.label },
  indexNumber: { width: '22%', fontSize: 9, paddingHorizontal: 4 },
  indexDate: { width: '24%', fontSize: 9, paddingHorizontal: 4 },
  indexType: { width: '22%', fontSize: 9, paddingHorizontal: 4 },
  indexPlace: { width: '32%', fontSize: 9, paddingHorizontal: 4 },
  // Footer ------------------------------------------------------------------
  footer: {
    position: 'absolute',
    left: SIDE,
    right: SIDE,
    bottom: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 6,
  },
  footerText: { fontSize: 8, color: COLORS.muted },
})

function fmt(iso: string, pattern: string): string {
  try {
    return format(new Date(iso), pattern, { locale: ptBR })
  } catch {
    return '—'
  }
}

/** Fallback brand mark, used until `public/logo-relatorio.png` is provided. */
function BrandMark() {
  return (
    <View style={{ alignItems: 'center' }}>
      <Svg width={44} height={52} viewBox="0 0 44 52">
        <Path
          d="M22 2 L40 9 V26 C40 38 32 46 22 50 C12 46 4 38 4 26 V9 Z"
          fill="#1D4ED8"
          stroke="#FFFFFF"
          strokeWidth={2}
        />
        <Path d="M22 12 L32 16 V26 C32 33 27 38 22 41 C17 38 12 33 12 26 V16 Z" fill="#FFFFFF" />
      </Svg>
      <Text style={styles.markText}>SIGOP</Text>
    </View>
  )
}

function Cell({
  label,
  value,
  wide = false,
}: {
  label: string
  value: string | null | undefined
  /** Spans two of the four grid columns. */
  wide?: boolean
}) {
  return (
    <View style={wide ? [styles.cell, styles.cellWide] : styles.cell}>
      <Text style={styles.cellLabel}>{label}</Text>
      <Text style={styles.cellValue}>{value || '—'}</Text>
    </View>
  )
}

function generatedLine(generatedBy: string | null, generatedAt: string): string {
  return [
    'SIGOP · Documento de uso interno',
    `Gerado ${generatedBy ? `por ${generatedBy} ` : ''}em ${fmt(generatedAt, "dd/MM/yyyy 'às' HH:mm")}`,
  ].join(' · ')
}

/** Footer repeated on every page; numbering spans the whole document. */
function Footer({ line }: { line: string }) {
  return (
    <View style={styles.footer} fixed>
      <Text style={styles.footerText}>{line}</Text>
      <Text
        style={styles.footerText}
        render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`}
      />
    </View>
  )
}

export function RelatorioOcorrenciaPdf({ report }: { report: IncidentReport }) {
  return (
    <Document
      title={`Relatório de Ocorrência ${report.internalNumber}`}
      author="SIGOP"
      subject={`Ocorrência ${report.internalNumber}`}
    >
      <IncidentPage report={report} />
    </Document>
  )
}

/**
 * Bulk export: a cover page (period, type, index of incidents) followed by
 * each incident laid out exactly like the single-incident report.
 */
export function RelatorioOcorrenciasLotePdf({ bulk }: { bulk: BulkIncidentReport }) {
  const period = `${fmt(`${bulk.from}T00:00:00`, 'dd/MM/yyyy')} a ${fmt(`${bulk.to}T00:00:00`, 'dd/MM/yyyy')}`
  const typeLabel = bulk.type ? (INCIDENT_TYPE_LABELS[bulk.type] ?? bulk.type) : 'Todos'

  return (
    <Document
      title={`Relatório de Ocorrências ${period}`}
      author="SIGOP"
      subject={`Ocorrências de ${period} · Tipo: ${typeLabel}`}
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.banner}>
          <View style={styles.bannerLeft}>
            <Text style={styles.title}>{`Relatório de Ocorrências — ${period}`}</Text>
            <Text style={styles.subtitle}>Sistema de Gestão de Ocorrências Operacionais</Text>
          </View>
          <View style={styles.bannerRight}>
            {bulk.logoSrc ? <Image src={bulk.logoSrc} style={styles.logo} /> : <BrandMark />}
            <Text style={styles.bannerDate}>{fmt(bulk.generatedAt, 'dd/MM/yyyy')}</Text>
          </View>
        </View>

        <View style={styles.grid}>
          <Cell label="Período" value={period} wide />
          <Cell label="Tipo" value={typeLabel} />
          <Cell label="Total de ocorrências" value={String(bulk.reports.length)} />
        </View>

        <View style={styles.body}>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Ocorrências incluídas</Text>
            <View style={[styles.indexRow, styles.indexHead]}>
              <Text style={[styles.indexNumber, styles.indexHeadText]}>Nº</Text>
              <Text style={[styles.indexDate, styles.indexHeadText]}>Data e hora</Text>
              <Text style={[styles.indexType, styles.indexHeadText]}>Tipo</Text>
              <Text style={[styles.indexPlace, styles.indexHeadText]}>Município</Text>
            </View>
            {bulk.reports.map((report, index) => (
              <View key={`${report.internalNumber}-${index}`} style={styles.indexRow} wrap={false}>
                <Text style={styles.indexNumber}>{report.internalNumber}</Text>
                <Text style={styles.indexDate}>{fmt(report.occurredAt, 'dd/MM/yyyy HH:mm')}</Text>
                <Text style={styles.indexType}>
                  {INCIDENT_TYPE_LABELS[report.type] ?? report.type}
                </Text>
                <Text style={styles.indexPlace}>{report.municipality || '—'}</Text>
              </View>
            ))}
          </View>
        </View>

        <Footer line={generatedLine(bulk.generatedBy, bulk.generatedAt)} />
      </Page>

      {bulk.reports.map((report, index) => (
        <IncidentPage key={`${report.internalNumber}-${index}`} report={report} />
      ))}
    </Document>
  )
}

function IncidentPage({ report }: { report: IncidentReport }) {
  const typeLabel = INCIDENT_TYPE_LABELS[report.type] ?? report.type
  const typeFull = report.subtype ? `${typeLabel} · ${report.subtype}` : typeLabel
  const agent = report.agentName

  return (
    <Page size="A4" style={styles.page}>
      {/* Header ---------------------------------------------------------- */}
      <View style={styles.banner}>
        <View style={styles.bannerLeft}>
          <Text style={styles.title}>
            {`Relatório de Ocorrência — ${report.internalNumber} | ${typeLabel}`}
          </Text>
          <Text style={styles.subtitle}>Sistema de Gestão de Ocorrências Operacionais</Text>
        </View>
        <View style={styles.bannerRight}>
          {report.logoSrc ? <Image src={report.logoSrc} style={styles.logo} /> : <BrandMark />}
          <Text style={styles.bannerDate}>{fmt(report.occurredAt, 'dd/MM/yyyy')}</Text>
        </View>
      </View>

      <View style={styles.grid}>
        <Cell label="Agente" value={agent} />
        <Cell label="Nº da ocorrência" value={report.internalNumber} />
        <Cell label="Município" value={report.municipality} />
        <Cell label="AT" value={report.territorialArea} />
        <Cell label="Tipo" value={typeFull} />
        <Cell label="Data e hora" value={fmt(report.occurredAt, 'dd/MM/yyyy HH:mm')} />
        <Cell label="Contratada" value={report.contractor} />
      </View>

      <View style={styles.body}>
        {/* Local ---------------------------------------------------------- */}
        {report.address ? (
          <View style={styles.section} wrap={false}>
            <Text style={styles.sectionTitle}>Local</Text>
            <Text style={styles.paragraph}>{report.address}</Text>
          </View>
        ) : null}

        {/* Descrição ------------------------------------------------------ */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Descrição</Text>
          <Text style={styles.paragraph}>{report.description || '—'}</Text>
        </View>

        {/* Fotos ---------------------------------------------------------- */}
        {report.photos.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle} minPresenceAhead={180}>
              {`Fotos da ocorrência (${report.photos.length})`}
            </Text>
            <View style={styles.photoGrid}>
              {report.photos.map((photo, index) => (
                <View key={photo.id} style={styles.photoCell} wrap={false}>
                  <View style={styles.photoFrame}>
                    <Image src={photo.src} style={styles.photo} />
                  </View>
                  <Text style={styles.caption}>
                    {`Foto ${index + 1}${photo.description ? ` — ${photo.description}` : ''}`}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* Pessoas envolvidas -------------------------------------------- */}
        {report.offenders.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle} minPresenceAhead={120}>
              {`Pessoas envolvidas (${report.offenders.length})`}
            </Text>
            {report.offenders.map((offender) => (
              <View key={offender.id} style={styles.offenderCard} wrap={false}>
                {offender.photoSrc ? (
                  <Image src={offender.photoSrc} style={styles.offenderPhoto} />
                ) : (
                  <View style={styles.offenderPhotoEmpty}>
                    <Text style={styles.mutedText}>Sem foto</Text>
                  </View>
                )}
                <View style={styles.offenderInfo}>
                  <Text style={styles.offenderName}>{offender.name}</Text>
                  {offender.nickname ? (
                    <Text style={styles.offenderNick}>{`Vulgo: ${offender.nickname}`}</Text>
                  ) : null}
                  <Text style={styles.roleChip}>{offender.roleLabel}</Text>
                  <View style={{ marginTop: 4 }}>
                    {offender.traits.length === 0 ? (
                      <Text style={[styles.mutedText, { marginTop: 3 }]}>
                        Sem características registradas.
                      </Text>
                    ) : (
                      offender.traits.map(([label, value]) => (
                        <View key={label} style={styles.traitRow}>
                          <Text style={styles.traitLabel}>{label}</Text>
                          <Text style={styles.traitValue}>{value}</Text>
                        </View>
                      ))
                    )}
                  </View>
                </View>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      <Footer line={generatedLine(report.generatedBy, report.generatedAt)} />
    </Page>
  )
}
