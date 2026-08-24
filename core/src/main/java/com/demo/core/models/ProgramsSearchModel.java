/*
 * Copyright 2026 Demo AI Site
 */
package com.demo.core.models;

import org.apache.commons.lang3.StringUtils;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ChildResource;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

import javax.annotation.PostConstruct;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class ProgramsSearchModel {

    @ValueMapValue private String heading;
    @ValueMapValue private String statNumber;
    @ValueMapValue private String statLabel;
    @ValueMapValue private String searchLabel;
    @ValueMapValue private String searchPlaceholder;
    @ValueMapValue private String browseHeading;

    @ChildResource private List<PillItem> pills;
    @ChildResource private List<SchoolItem> schools;

    @PostConstruct
    protected void init() {
        pills = filterPills(pills);
        schools = filterSchools(schools);
    }

    private List<PillItem> filterPills(List<PillItem> input) {
        if (input == null) return Collections.emptyList();
        List<PillItem> out = new ArrayList<>();
        for (PillItem p : input) {
            if (p != null && StringUtils.isNotBlank(p.getLabel())) out.add(p);
        }
        return out;
    }

    private List<SchoolItem> filterSchools(List<SchoolItem> input) {
        if (input == null) return Collections.emptyList();
        List<SchoolItem> out = new ArrayList<>();
        for (SchoolItem s : input) {
            if (s != null && StringUtils.isNotBlank(s.getName())) out.add(s);
        }
        return out;
    }

    public String getHeading() { return heading; }
    public String getStatNumber() { return statNumber; }
    public String getStatLabel() { return statLabel; }
    public String getSearchLabel() { return searchLabel; }
    public String getSearchPlaceholder() { return searchPlaceholder; }
    public String getBrowseHeading() { return browseHeading; }
    public List<PillItem> getPills() { return pills; }
    public List<SchoolItem> getSchools() { return schools; }

    public boolean isHasContent() {
        return StringUtils.isNotBlank(heading)
            || StringUtils.isNotBlank(statNumber)
            || (pills != null && !pills.isEmpty())
            || (schools != null && !schools.isEmpty());
    }

    @Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
    public static class PillItem {
        @ValueMapValue private String label;
        @ValueMapValue private String link;
        public String getLabel() { return label; }
        public String getLink() { return link; }
    }

    @Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
    public static class SchoolItem {
        @ValueMapValue private String name;
        @ValueMapValue private String link;
        public String getName() { return name; }
        public String getLink() { return link; }
    }
}
