/*
 *  Copyright 2025 Adobe Systems Incorporated
 */
package com.demo.core.models;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.stream.Collectors;
import javax.annotation.PostConstruct;

import org.apache.commons.lang3.StringUtils;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.Default;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ChildResource;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class ResultsColumnsModel {

    @ValueMapValue
    private String title;

    @ValueMapValue
    private String subtitle;

    @ValueMapValue
    @Default(values = "lg")
    private String sectionPadding;

    @ValueMapValue
    @Default(values = "cream")
    private String backgroundColor;

    @ValueMapValue
    private String hexColor;

    @ChildResource
    private List<ResultsColumn> columns;

    @PostConstruct
    protected void init() {
        if (columns == null) {
            columns = Collections.emptyList();
        } else {
            columns = columns.stream().filter(ResultsColumn::isHasContent).collect(Collectors.toList());
        }
    }

    public String getTitle() { return title; }
    public String getSubtitle() { return subtitle; }
    public String getSectionPadding() { return sectionPadding; }
    public String getBackgroundColor() { return backgroundColor; }

    public List<ResultsColumn> getColumns() {
        return columns == null ? Collections.emptyList() : new ArrayList<>(columns);
    }

    public String getBackgroundStyle() {
        if ("other".equals(backgroundColor) && StringUtils.isNotBlank(hexColor)) {
            return "background-color: " + hexColor.trim() + ";";
        }
        return null;
    }

    public boolean isHasContent() {
        return StringUtils.isNotBlank(title) || (columns != null && !columns.isEmpty());
    }

    @Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
    public static class ResultsColumn {
        @ValueMapValue
        private String columnLabel;

        @ValueMapValue
        private String entries;

        public String getColumnLabel() { return columnLabel; }
        public String getEntries() { return entries; }

        public List<String> getEntriesList() {
            if (StringUtils.isBlank(entries)) {
                return Collections.emptyList();
            }
            return Arrays.stream(entries.split("\\r?\\n"))
                    .map(String::trim)
                    .filter(StringUtils::isNotBlank)
                    .collect(Collectors.toList());
        }

        public boolean isHasContent() {
            return StringUtils.isNotBlank(columnLabel) || !getEntriesList().isEmpty();
        }
    }
}
