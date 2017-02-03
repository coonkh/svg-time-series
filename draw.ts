﻿import { scaleLinear, scaleTime } from 'd3-scale'
import { BaseType, event as d3event, selectAll, Selection } from 'd3-selection'
import { line } from 'd3-shape'
import { timeout as runTimeout } from 'd3-timer'
import { zoom as d3zoom, ZoomTransform } from 'd3-zoom'

import { MyAxis, Orientation } from './axis'
import { MyTransform } from './MyTransform'
import { IMinMax, SegmentTree } from './segmentTree'
import { AR1Basis } from './viewZoomTransform'

interface IChartParameters {
	view: any
	data: number[][]
	line: Function
	update: () => void
	zoom: () => void
}

function drawProc(f: Function) {
	let requested = false

	return (...params: any[]) => {
		if (!requested) {
			requested = true
			runTimeout((elapsed: number) => {
				requested = false
				f(params)
			})
		}
	}
}

export class TimeSeriesChart {
	private chart: IChartParameters

	// updated when a new point is added
	private tree: SegmentTree

	// Updated when a new point is added
	// used to convert indices to dates shown by X axis
	// Date.now() style timestamp
	private timeAtIdx0: number

	// Step by X axis
	// Date.now() style timestamp delta
	private timeStep: number
	
	// две точки - начало и конец массива в пространстве индексов
	// стоит думать о них как об абстрактных точках образующих
	// базис, а не в терминах их координат
	private bIndexFull: AR1Basis

	private buildSegmentTreeTuple: (index: number, elements: any) => IMinMax
	private zoomHandler: () => void

	constructor(
		svg: Selection<BaseType, {}, HTMLElement, any>,
		startTime: number, timeStep: number,
		data: number[][],
		buildSegmentTreeTuple: (index: number, elements: any) => IMinMax,
		zoomHandler: () => void) {
		this.timeStep = timeStep
		this.timeAtIdx0 = startTime
		this.buildSegmentTreeTuple = buildSegmentTreeTuple
		this.zoomHandler = zoomHandler
		this.bIndexFull = new AR1Basis(0, data.length - 1)
		this.drawChart(svg, data)
	}

	public updateChartWithNewData(newData: number[]) {
		this.chart.data.push(newData)
		this.chart.data.shift()

		this.timeAtIdx0 += this.timeStep

		this.drawNewData()
	}

	public zoom() {
		this.chart.zoom()
	}

	private drawChart(svg: Selection<BaseType, {}, HTMLElement, any>, data: number[][]) {
		const node: SVGSVGElement = svg.node() as SVGSVGElement
		const div: HTMLElement = node.parentNode as HTMLElement

		const width = div.clientWidth
		const height = div.clientHeight

		svg.attr('width', width)
		svg.attr('height', height)

		const drawLine = (cityIdx: number) => line()
			.defined((d: [number, number]) => {
				return !(isNaN(d[cityIdx]) || d[cityIdx] == null)
			})
			.x((d: [number, number], i: number) => i)
			.y((d: [number, number]) => d[cityIdx])

		this.tree = new SegmentTree(data, data.length, this.buildSegmentTreeTuple)

		const view = svg.select('g.view')
		const path = view
			.selectAll('path')
			.data([0, 1])
			.enter().append('path')
			.attr('d', (cityIndex: number) => drawLine(cityIndex).call(null, data))

		// тут наши перевернутые базисы которые мы
		// cтеснительно запрятали в onViewPortResize
		// таки вылезли
		// с базисами в шкалах надо что-то делать	
		const x = scaleTime().range([0, width])
		const y = scaleLinear().range([height, 0])
		const viewNode: SVGGElement = view.node() as SVGGElement
		const pathTransform = new MyTransform(svg.node() as SVGSVGElement, viewNode)

		// minIdxX and maxIdxX are indexes (model X coordinates) at chart edges
		// so they are updated by zoom and pan or animation
		// but unaffected by arrival of new data
		const updateScales = (bIndexVisible: AR1Basis) => {
			const idxToTime = (idx: number) => this.getTimeByIndex(idx, this.timeAtIdx0)

			// просто функция между базисами
			const [minIdxX, maxIdxX] = bIndexVisible.toArr()
			const { min, max } = this.tree.getMinMax(minIdxX, maxIdxX)
			const bTemperatureVisible = new AR1Basis(min, max)

			// референсное окно имеет достаточно странный вид
			// по горизонтали у нас полный диапазон
			// а по вертикали только видимый
			// надеюсь это исправится при переходе от отдельных
			// пространств по Х и Y к единому пространству
			// являющeмся их прямым произведением
			pathTransform.onReferenceViewWindowResize(this.bIndexFull, bTemperatureVisible)
			
			// временная обертка чтобы получить bTimeVisible
			// в явном виде
			[ minTimeVisible, maxTimeVisible ] = bIndexVisible.toArr().map(idxToTime))
			const bTimeVisible = new AR1Basis(minTimeVisible, maxTimeVisible)
			x.domain(bTimeVisible.toArr())
			y.domain(bTemperatureVisible.toArr())

		}

		updateScales(this.bIndexFull)

		const xAxis = new MyAxis(Orientation.Bottom, x)
			.ticks(4)
			.setTickSize(height)
			.setTickPadding(8 - height)
			.setScale(x)

		const yAxis = new MyAxis(Orientation.Right, y)
			.ticks(4)
			.setTickSize(width)
			.setTickPadding(2 - width)
			.setScale(y)

		const gX = svg.append('g')
			.attr('class', 'axis')
			.call(xAxis.axis.bind(xAxis))

		const gY = svg.append('g')
			.attr('class', 'axis')
			.call(yAxis.axis.bind(yAxis))

		// it's important that we have only 1 instance
		// of drawProc and not one per event
		const scheduleRefresh = drawProc(() => {
			// на видимую область можно смотреть абстрактно
			// как на отдельное пространство

			const bScreenXVisible = new AR1Basis(0, width)

			const bIndexVisible = pathTransform.fromScreenToModelBasisX(bScreenXVisible)
			updateScales(bIndexVisible)
			pathTransform.updateViewNode()

			xAxis.axisUp(gX)
			yAxis.axisUp(gY)
		})

		const newZoom = () => {
			pathTransform.onZoomPan(d3event.transform)
			scheduleRefresh()
		}

		const bPlaceholder = new AR1Basis(0, 1)
		// тут ещё 2 базиса затесались может стоит их вынести
		pathTransform.onViewPortResize(width, height)
		pathTransform.onReferenceViewWindowResize(this.bIndexFull, bPlaceholder)
		pathTransform.updateViewNode()
		scheduleRefresh()
		svg.append('rect')
			.attr('class', 'zoom')
			.attr('width', width)
			.attr('height', height)
			.call(d3zoom()
				.scaleExtent([1, 40])
				.translateExtent([[0, 0], [width, height]])
				.on('zoom', this.zoomHandler.bind(this)))

		this.chart = {
			view, data, line: drawLine,
			update: scheduleRefresh,
			zoom: newZoom,
		}
	}

	// это должно вызываться при создании чарта
	// а не дублироваться
	private drawNewData = drawProc(function() {
		this.tree = new SegmentTree(this.chart.data, this.chart.data.length, this.buildSegmentTreeTuple)
		this.chart.update()
		this.chart.view
			.selectAll('path')
			.attr('d', (cityIndex: number) => this.chart.line(cityIndex).call(null, this.chart.data))

	}.bind(this))

	private getTimeByIndex(index: number, startTime: number) : number {
		return index * this.timeStep + startTime
	}
}
